/*
 * Copyright 2018 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const fs = require('mz/fs');
const request = require('request-promise-native');
const stringify = require('json-stable-stringify');

const CliArgParser = require('./cli-arg-parser');
const GitRepo = require('./git-repo');

/**
 * Reads and writes a `golden.json` or `snapshot.json` file.
 */
class SnapshotStore {
  constructor() {
    /**
     * @type {!CliArgParser}
     * @private
     */
    this.cliArgs_ = new CliArgParser();

    /**
     * @type {!GitRepo}
     * @private
     */
    this.gitRepo_ = new GitRepo();

    /**
     * @type {?SnapshotSuiteJson}
     * @private
     */
    this.cachedGoldenJsonFromDiffBase_ = null;
  }

  /**
   * Writes the data to the given `golden.json` file path.
   * @param {!ReportSuiteJson} reportJson
   * @return {!Promise<string>}
   */
  async getSnapshotJsonString(reportJson) {
    const jsonData = await this.getJsonData_(reportJson);
    return this.stringify_(jsonData);
  }

  stringify_(jsonData) {
    return stringify(jsonData, {space: '  '}) + '\n';
  }

  /**
   * @return {!Promise<void>}
   */
  async approveChanges() {
    /** @type {!ReportSuiteJson} */
    const reportJson = await request({
      uri: this.cliArgs_.reportJsonUrl,
      json: true,
    });

    if (this.cliArgs_.hasAnyApprovalFilters()) {
      return this.writeFilteredToDisk_(reportJson);
    } else {
      return this.writeAllToDisk_(reportJson);
    }
  }

  /**
   * @param {!ReportSuiteJson} reportJson
   * @return {!Promise<void>}
   * @private
   */
  async writeFilteredToDisk_(reportJson) {
    reportJson = this.deepCloneJson_(reportJson);

    console.log('reportJson:', reportJson);

    const diffFilters = this.cliArgs_.approvedDiffs;
    reportJson.diffs = reportJson.diffs.filter((diff) => {
      return diffFilters.find((filter) => {
        return filter.htmlFilePath === diff.htmlFilePath &&
          filter.userAgentAlias === diff.userAgentAlias;
      });
    });

    const addedFilters = this.cliArgs_.approvedAdds;
    reportJson.added = reportJson.added.filter((added) => {
      return addedFilters.find((filter) => {
        return filter.htmlFilePath === added.htmlFilePath &&
          filter.userAgentAlias === added.userAgentAlias;
      });
    });

    const removedFilters = this.cliArgs_.approvedRemoves;
    reportJson.removed = reportJson.removed.filter((removed) => {
      return removedFilters.find((filter) => {
        return filter.htmlFilePath === removed.htmlFilePath &&
          filter.userAgentAlias === removed.userAgentAlias;
      });
    });

    const oldJsonData = await this.fromDiffBase();
    const newJsonData = this.deepCloneJson_(oldJsonData);

    reportJson.diffs.forEach((diff) => {
      const htmlFilePath = diff.htmlFilePath;
      const userAgentAlias = diff.userAgentAlias;
      const snapshotPageUrl = diff.snapshotPageUrl;
      newJsonData[htmlFilePath].screenshots[userAgentAlias] = snapshotPageUrl;
    });

    reportJson.added.forEach((added) => {
      const htmlFilePath = added.htmlFilePath;
      const userAgentAlias = added.userAgentAlias;
      const snapshotPageUrl = added.snapshotPageUrl;
      newJsonData[htmlFilePath] = newJsonData[htmlFilePath] || {
        publicUrl: snapshotPageUrl,
        screenshots: {},
      };
      newJsonData[htmlFilePath].screenshots[userAgentAlias] = snapshotPageUrl;
    });

    reportJson.removed.forEach((removed) => {
      const htmlFilePath = removed.htmlFilePath;
      const userAgentAlias = removed.userAgentAlias;
      delete newJsonData[htmlFilePath].screenshots[userAgentAlias];
      if (newJsonData[htmlFilePath].screenshots.length === 0) {
        delete newJsonData[htmlFilePath];
      }
    });

    return this.writeToDiskImpl_(newJsonData);
  }

  /**
   * @param {!ReportSuiteJson} reportJson
   * @return {!Promise<void>}
   * @private
   */
  async writeAllToDisk_(reportJson) {
    const jsonData = await this.getJsonData_(reportJson);
    await this.writeToDiskImpl_(jsonData);
  }

  async writeToDiskImpl_(jsonData) {
    const jsonFileContent = this.stringify_(jsonData);
    const jsonFilePath = this.cliArgs_.goldenPath;

    console.log('jsonData:', jsonData);

    await fs.writeFile(jsonFilePath, jsonFileContent);

    console.log(`\n\nDONE updating "${jsonFilePath}"!\n\n`);
  }

  /**
   * Parses the `golden.json` file specified by the `--mdc-diff-base` CLI arg.
   * @return {!Promise<!SnapshotSuiteJson>}
   */
  async fromDiffBase() {
    if (!this.cachedGoldenJsonFromDiffBase_) {
      this.cachedGoldenJsonFromDiffBase_ = JSON.parse(await this.fetchGoldenJsonString_());
    }

    // Deep-clone the cached object to avoid accidental mutation of shared state
    return this.deepCloneJson_(this.cachedGoldenJsonFromDiffBase_);
  }

  /**
   * Transforms the given test cases into `golden.json` format.
   * @param {!Array<!UploadableTestCase>} testCases
   * @return {!Promise<!SnapshotSuiteJson>}
   */
  async fromTestCases(testCases) {
    const jsonData = {};

    testCases.forEach((testCase) => {
      const htmlFileKey = testCase.htmlFile.destinationRelativeFilePath;
      const htmlFileUrl = testCase.htmlFile.publicUrl;

      jsonData[htmlFileKey] = {
        publicUrl: htmlFileUrl,
        screenshots: {},
      };

      testCase.screenshotImageFiles.forEach((screenshotImageFile) => {
        const screenshotKey = screenshotImageFile.userAgent.alias;
        const screenshotUrl = screenshotImageFile.publicUrl;

        jsonData[htmlFileKey].screenshots[screenshotKey] = screenshotUrl;
      });
    });

    return jsonData;
  }

  /**
   * @return {!Promise<string>}
   * @private
   */
  async fetchGoldenJsonString_() {
    /** @type {!DiffSource} */
    const diffSource = await this.cliArgs_.parseDiffBase();

    const publicUrl = diffSource.publicUrl;
    if (publicUrl) {
      return request({
        method: 'GET',
        uri: publicUrl,
      });
    }

    const localFilePath = diffSource.localFilePath;
    if (localFilePath) {
      return fs.readFile(localFilePath, {encoding: 'utf8'});
    }

    const rev = diffSource.gitRevision;
    if (rev) {
      return this.gitRepo_.getFileAtRevision(rev.snapshotFilePath, rev.commit);
    }

    const rawDiffBase = this.cliArgs_.diffBase;
    throw new Error(`Unable to parse '--mdc-diff-base=${rawDiffBase}': Expected a URL, local file path, or git ref`);
  }

  /**
   * @param {!ReportSuiteJson} reportJson
   * @return {!Promise<!SnapshotSuiteJson>}
   * @private
   */
  async getJsonData_(reportJson) {
    return this.cliArgs_.hasAnyFilters()
      ? await this.updateFilteredScreenshots_(reportJson)
      : await this.updateAllScreenshots_(reportJson);
  }

  /**
   * @param {!ReportSuiteJson} reportJson
   * @return {!Promise<!SnapshotSuiteJson>}
   * @private
   */
  async updateFilteredScreenshots_(reportJson) {
    const {testCases, diffs} = reportJson;
    const oldJsonData = await this.fromDiffBase();
    const newJsonData = await this.fromTestCases(testCases);
    const jsonData = this.deepCloneJson_(oldJsonData);

    diffs.forEach((diff) => {
      const htmlFilePath = diff.htmlFilePath;
      const browserKey = diff.browserKey;
      const newPage = newJsonData[htmlFilePath];
      if (jsonData[htmlFilePath]) {
        jsonData[htmlFilePath].publicUrl = newPage.publicUrl;
        jsonData[htmlFilePath].screenshots[browserKey] = newPage.screenshots[browserKey];
      } else {
        jsonData[htmlFilePath] = this.deepCloneJson_(newPage);
      }
    });

    return jsonData;
  }

  /**
   * @param {!ReportSuiteJson} reportJson
   * @return {!Promise<!SnapshotSuiteJson>}
   * @private
   */
  async updateAllScreenshots_(reportJson) {
    const {testCases, diffs} = reportJson;
    const oldJsonData = await this.fromDiffBase();
    const newJsonData = await this.fromTestCases(testCases);

    const existsInOldJsonData = ([htmlFilePath]) => htmlFilePath in oldJsonData;

    /** @type {!Array<[string, !SnapshotPageJson]>} */
    const newMatchingPageEntries = Object.entries(newJsonData).filter(existsInOldJsonData);

    for (const [htmlFilePath, newPage] of newMatchingPageEntries) {
      let pageHasDiffs = false;

      for (const browserKey of Object.keys(newPage.screenshots)) {
        const oldUrl = oldJsonData[htmlFilePath].screenshots[browserKey];
        const screenshotHasDiff = diffs.find((diff) => {
          return diff.htmlFilePath === htmlFilePath && diff.browserKey === browserKey;
        });

        if (oldUrl && !screenshotHasDiff) {
          newPage.screenshots[browserKey] = oldUrl;
        }

        if (screenshotHasDiff) {
          pageHasDiffs = true;
        }
      }

      if (!pageHasDiffs) {
        newPage.publicUrl = oldJsonData[htmlFilePath].publicUrl;
      }
    }

    return newJsonData;
  }

  /**
   * Creates a deep clone of the given `source` object's own enumerable properties.
   * Non-JSON-serializable properties (such as functions or symbols) are silently discarded.
   * The returned value is structurally equivalent, but not referentially equal, to the input.
   * In Java parlance:
   *   clone.equals(source) // true
   *   clone == source      // false
   * @param {!T} source JSON object to clone
   * @return {!T} Deep clone of `source` object
   * @template T
   * @private
   */
  deepCloneJson_(source) {
    return JSON.parse(JSON.stringify(source));
  }
}

module.exports = SnapshotStore;
