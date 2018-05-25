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

const compareImages = require('resemblejs/compareImages');

/**
 * Computes the difference between two screenshot images and generates an image that highlights the pixels that changed.
 */
class ImageDiffer {
  constructor({imageCache}) {
    /**
     * @type {!ImageCache}
     * @private
     */
    this.imageCache_ = imageCache;
  }

  /**
   * @param {!Array<!UploadableTestCase>} testCases
   * @param {!SnapshotSuiteJson} actualSuite
   * @param {!SnapshotSuiteJson} expectedSuite
   * @return {!Promise<!ReportSuiteJson>}
   */
  async compareAllPages({
    testCases,
    actualSuite,
    expectedSuite,
  }) {
    /** @type {!Array<!Promise<!Array<!ImageDiffJson>>>} */
    const pageComparisonPromises = [];

    const diffs = [];
    const added = this.getAdded_({expectedSuite, actualSuite});
    const removed = this.getRemoved_({expectedSuite, actualSuite});
    const unchanged = [];

    for (const [htmlFilePath, actualPage] of Object.entries(actualSuite)) {
      // HTML file is not present in `golden.json` on `master`
      const expectedPage = expectedSuite[htmlFilePath];
      if (!expectedPage) {
        continue;
      }

      pageComparisonPromises.push(
        this.compareOnePage_({
          htmlFilePath,
          goldenPageUrl: expectedPage.publicUrl,
          snapshotPageUrl: actualPage.publicUrl,
          actualPage,
          expectedPage,
        })
      );
    }

    // Flatten the array of arrays
    const pageComparisonResults = [].concat(...(await Promise.all(pageComparisonPromises)));

    pageComparisonResults.forEach((diffResult) => {
      if (diffResult.diffImageBuffer) {
        diffs.push(diffResult);
      } else {
        unchanged.push(diffResult);
      }
    });

    /**
     * @param {!ImageDiffJson} a
     * @param {!ImageDiffJson} b
     */
    function compareDiffsForSorting(a, b) {
      return a.htmlFilePath.localeCompare(b.htmlFilePath, 'en-US') ||
        a.userAgentAlias.localeCompare(b.userAgentAlias, 'en-US');
    }

    diffs.sort(compareDiffsForSorting);
    added.sort(compareDiffsForSorting);
    removed.sort(compareDiffsForSorting);
    unchanged.sort(compareDiffsForSorting);

    return {
      diffs,
      added,
      removed,
      unchanged,
      testCases,
    };
  }

  /**
   * @param {string} htmlFilePath
   * @param {string} goldenPageUrl
   * @param {string} snapshotPageUrl
   * @param {!SnapshotPageJson} expectedPage
   * @param {!SnapshotPageJson} actualPage
   * @return {!Promise<!Array<!ImageDiffJson>>}
   * @private
   */
  async compareOnePage_({
    htmlFilePath,
    goldenPageUrl,
    snapshotPageUrl,
    actualPage,
    expectedPage,
  }) {
    /** @type {!Array<!Promise<!ImageDiffJson>>} */
    const imagePromises = [];

    const actualScreenshots = actualPage.screenshots;
    const expectedScreenshots = expectedPage.screenshots;

    for (const [userAgentAlias, actualImageUrl] of Object.entries(actualScreenshots)) {
      // Screenshot image for this browser is not present in `golden.json` on `master`
      const expectedImageUrl = expectedScreenshots[userAgentAlias];
      if (!expectedImageUrl) {
        continue;
      }

      imagePromises.push(
        this.compareOneImage_({actualImageUrl, expectedImageUrl})
          .then(
            (diffImageBuffer) => ({
              htmlFilePath,
              goldenPageUrl,
              snapshotPageUrl,
              userAgentAlias,
              expectedImageUrl,
              actualImageUrl,
              diffImageUrl: null, // populated by `Controller`
              diffImageBuffer,
            }),
            (err) => Promise.reject(err)
          )
      );
    }

    return Promise.all(imagePromises);
  }

  /**
   * @param {string} actualImageUrl
   * @param {string} expectedImageUrl
   * @return {!Promise<?Buffer>}
   * @private
   */
  async compareOneImage_({
    actualImageUrl,
    expectedImageUrl,
  }) {
    console.log(`➡ Comparing snapshot to golden: "${actualImageUrl}" vs. "${expectedImageUrl}"...`);

    const [actualImageBuffer, expectedImageBuffer] = await Promise.all([
      this.imageCache_.getImageBuffer(actualImageUrl),
      this.imageCache_.getImageBuffer(expectedImageUrl),
    ]);

    const diffResult = await this.computeDiff_({
      actualImageBuffer,
      expectedImageBuffer,
    });

    if (diffResult.rawMisMatchPercentage < 0.01) {
      console.log(`✔ No diffs found for "${actualImageUrl}"!`);
      return null;
    }

    console.log(`✗︎ Image "${actualImageUrl}" has changed!`);
    return diffResult.getBuffer();
  }

  /**
   * @param {!Buffer} actualImageBuffer
   * @param {!Buffer} expectedImageBuffer
   * @return {!Promise<!ResembleApiComparisonResult>}
   * @private
   */
  async computeDiff_({
    actualImageBuffer,
    expectedImageBuffer,
  }) {
    const options = require('../resemble.json');
    return await compareImages(
      actualImageBuffer,
      expectedImageBuffer,
      options
    );
  }

  /**
   * @param {!SnapshotSuiteJson} expectedSuite
   * @param {!SnapshotSuiteJson} actualSuite
   * @return {!Array<!ImageDiffJson>}
   * @private
   */
  getAdded_({expectedSuite, actualSuite}) {
    const added = [];

    for (const [htmlFilePath, actualPage] of Object.entries(actualSuite)) {
      const expectedPage = expectedSuite[htmlFilePath];
      if (expectedPage) {
        added.push(...this.getAddedActualScreenshotsAsDiffObjects_({expectedPage, actualPage, htmlFilePath}));
      } else {
        added.push(...this.getAllActualScreenshotsAsDiffObjects_({actualPage, htmlFilePath}));
      }
    }

    return added;
  }

  /**
   * @param {!SnapshotPageJson} expectedPage
   * @param {!SnapshotPageJson} actualPage
   * @param {string} htmlFilePath
   * @return {!Array<!ImageDiffJson>}
   * @private
   */
  getAddedActualScreenshotsAsDiffObjects_({expectedPage, actualPage, htmlFilePath}) {
    const added = [];

    for (const [userAgentAlias, actualImageUrl] of Object.entries(actualPage.screenshots)) {
      if (expectedPage.screenshots[userAgentAlias]) {
        continue;
      }

      added.push({
        htmlFilePath,
        goldenPageUrl: null,
        snapshotPageUrl: actualPage.publicUrl,
        userAgentAlias,
        actualImageUrl,
        expectedImageUrl: null,
        diffImageBuffer: null,
        diffImageUrl: null,
      });
    }

    return added;
  }

  /**
   * @param {!SnapshotPageJson} actualPage
   * @param {string} htmlFilePath
   * @return {!Array<!ImageDiffJson>}
   * @private
   */
  getAllActualScreenshotsAsDiffObjects_({actualPage, htmlFilePath}) {
    const added = [];

    for (const [userAgentAlias, actualImageUrl] of Object.entries(actualPage.screenshots)) {
      added.push({
        htmlFilePath,
        goldenPageUrl: null,
        snapshotPageUrl: actualPage.publicUrl,
        userAgentAlias,
        actualImageUrl,
        expectedImageUrl: null,
        diffImageBuffer: null,
        diffImageUrl: null,
      });
    }

    return added;
  }

  /**
   * @param {!SnapshotSuiteJson} expectedSuite
   * @param {!SnapshotSuiteJson} actualSuite
   * @return {!Array<!ImageDiffJson>}
   * @private
   */
  getRemoved_({expectedSuite, actualSuite}) {
    const removed = [];

    for (const [htmlFilePath, expectedPage] of Object.entries(expectedSuite)) {
      const actualPage = actualSuite[htmlFilePath];
      if (actualPage) {
        removed.push(...this.getRemovedExpectedScreenshotsAsDiffObjects_({expectedPage, actualPage, htmlFilePath}));
      } else {
        removed.push(...this.getAllExpectedScreenshotsAsDiffObjects_({expectedPage, htmlFilePath}));
      }
    }

    return removed;
  }

  /**
   * @param {!SnapshotPageJson} expectedPage
   * @param {!SnapshotPageJson} actualPage
   * @param {string} htmlFilePath
   * @return {!Array<!ImageDiffJson>}
   * @private
   */
  getRemovedExpectedScreenshotsAsDiffObjects_({expectedPage, actualPage, htmlFilePath}) {
    const removed = [];

    for (const [userAgentAlias, expectedImageUrl] of Object.entries(expectedPage.screenshots)) {
      if (actualPage.screenshots[userAgentAlias]) {
        continue;
      }

      removed.push({
        htmlFilePath,
        goldenPageUrl: expectedPage.publicUrl,
        snapshotPageUrl: null,
        userAgentAlias,
        actualImageUrl: null,
        expectedImageUrl,
        diffImageBuffer: null,
        diffImageUrl: null,
      });
    }

    return removed;
  }

  /**
   * @param {!SnapshotPageJson} expectedPage
   * @param {string} htmlFilePath
   * @return {!Array<!ImageDiffJson>}
   * @private
   */
  getAllExpectedScreenshotsAsDiffObjects_({expectedPage, htmlFilePath}) {
    const removed = [];

    for (const [userAgentAlias, expectedImageUrl] of Object.entries(expectedPage.screenshots)) {
      removed.push({
        htmlFilePath,
        goldenPageUrl: expectedPage.publicUrl,
        snapshotPageUrl: null,
        userAgentAlias,
        actualImageUrl: null,
        expectedImageUrl,
        diffImageBuffer: null,
        diffImageUrl: null,
      });
    }

    return removed;
  }
}

module.exports = ImageDiffer;
