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

const GitRepo = require('./git-repo');
const CliArgParser = require('./cli-arg-parser');
const childProcess = require('mz/child_process');

const GITHUB_REPO_URL = 'https://github.com/material-components/material-components-web';

class ReportGenerator {
  /**
   * @param {!ReportSuiteJson} reportJson
   */
  constructor(reportJson) {
    /**
     * @type {!ReportSuiteJson}
     * @private
     */
    this.reportJson_ = reportJson;

    /**
     * @type {!GitRepo}
     * @private
     */
    this.gitRepo_ = new GitRepo();

    /**
     * @type {!CliArgParser}
     * @private
     */
    this.cliArgs_ = new CliArgParser();

    /**
     * @type {!Map<string, !Array<!ImageDiffJson>>}
     * @private
     */
    this.diffMap_ = new Map();

    /**
     * @type {!Map<string, !Array<!ImageDiffJson>>}
     * @private
     */
    this.addedMap_ = new Map();

    /**
     * @type {!Map<string, !Array<!ImageDiffJson>>}
     * @private
     */
    this.removedMap_ = new Map();

    /**
     * @type {!Map<string, !Array<!ImageDiffJson>>}
     * @private
     */
    this.unchangedMap_ = new Map();

    function populateMap(changelist, map) {
      changelist.forEach((diff) => {
        if (!map.has(diff.htmlFilePath)) {
          map.set(diff.htmlFilePath, []);
        }
        map.get(diff.htmlFilePath).push(diff);
      });
    }

    populateMap(this.reportJson_.diffs, this.diffMap_);
    populateMap(this.reportJson_.added, this.addedMap_);
    populateMap(this.reportJson_.removed, this.removedMap_);
    populateMap(this.reportJson_.unchanged, this.unchangedMap_);
  }

  async generateHtml({reportJsonUrl}) {
    const numDiffs = this.reportJson_.diffs.length;
    const numAdded = this.reportJson_.added.length;
    const numRemoved = this.reportJson_.removed.length;
    const numUnchanged = this.reportJson_.unchanged.length;

    const title = [
      `${numDiffs} Diff${numDiffs !== 1 ? 's' : ''}`,
      `${numAdded} Added`,
      `${numRemoved} Removed`,
      `${numUnchanged} Unchanged`,
    ].join(', ');

    /* eslint-disable indent */
    return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${title} - Screenshot Test Report - MDC Web</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="./out/report.css">
    <script src="./report.js"></script>
  </head>
  <body class="report-body" data-mdc-report-json-url="${reportJsonUrl}">
    <h1>
      Screenshot Test Report for
      <a href="https://github.com/material-components/material-components-web" target="_blank">MDC Web</a>
    </h1>
    ${this.getCollapseButtonMarkup_()}
    ${await this.getMetadataMarkup_()}
    ${await this.getChangelistMarkup_({
      changelist: this.reportJson_.diffs,
      map: this.diffMap_,
      isOpen: true,
      heading: 'Diff',
      type: 'diff',
      pluralize: true,
      showCheckboxes: true,
    })}
    ${await this.getChangelistMarkup_({
      changelist: this.reportJson_.added,
      map: this.addedMap_,
      isOpen: true,
      heading: 'Added',
      type: 'added',
      pluralize: false,
      showCheckboxes: true,
    })}
    ${await this.getChangelistMarkup_({
      changelist: this.reportJson_.removed,
      map: this.removedMap_,
      isOpen: true,
      heading: 'Removed',
      type: 'removed',
      pluralize: false,
      showCheckboxes: true,
    })}
    ${await this.getChangelistMarkup_({
      changelist: this.reportJson_.unchanged,
      map: this.unchangedMap_,
      isOpen: false,
      heading: 'Unchanged',
      type: 'unchanged',
      pluralize: false,
      showCheckboxes: false,
    })}
    ${this.getApprovalBarMarkup_()}
  </body>
</html>
`;
    /* eslint-enable indent */
  }

  /**
   * @param {!Array<!ImageDiffJson>} changelist
   * @param {!Map<string, !Array<!ImageDiffJson>>} map
   * @param {boolean} isOpen
   * @param {string} heading
   * @param {string} type
   * @param {boolean} pluralize
   * @param {boolean} showCheckboxes
   * @return {Promise<string>}
   * @private
   */
  async getChangelistMarkup_({changelist, map, isOpen, heading, type, pluralize, showCheckboxes}) {
    const numDiffs = changelist.length;

    return `
<details class="report-changelist" ${isOpen && numDiffs > 0 ? 'open' : ''} data-mdc-changelist-type="${type}">
  <summary class="report-changelist__heading">
    ${this.getCheckboxMarkup_(showCheckboxes && numDiffs > 0)}
    ${numDiffs} ${heading}${pluralize && numDiffs !== 1 ? 's' : ''}
  </summary>
  <div class="report-changelist__content">
    ${this.getDiffListMarkup_({changelist, map, showCheckboxes})}
  </div>
</details>
`;
  }

  getCheckboxMarkup_(isEnabled) {
    return isEnabled
      ? '<input type="checkbox" checked>'
      : '<input type="checkbox" style="visibility: hidden">'
    ;
  }

  async getMetadataMarkup_() {
    const timestamp = (new Date()).toISOString();
    const numTestCases = this.reportJson_.testCases.length;
    const numScreenshots = this.reportJson_.testCases
      .map((testCase) => testCase.screenshotImageFiles.length)
      .reduce((total, current) => total + current, 0)
    ;

    const [nodeBinPath, scriptPath, ...scriptArgs] = process.argv;
    const nodeBinPathRedacted = nodeBinPath.replace(process.env.HOME, '~');
    const scriptPathRedacted = scriptPath.replace(process.env.PWD, '.');
    const nodeArgs = process.execArgv;
    const cliInvocation = [nodeBinPathRedacted, ...nodeArgs, scriptPathRedacted, ...scriptArgs]
      .map((arg) => {
        // Heuristic for "safe" characters that don't need to be escaped or wrapped in single quotes to be copy/pasted
        // and run in a shell. This includes the letters a-z and A-Z, the numbers 0-9,
        // See https://ascii.cl/
        if (/^[,-9@-Z_a-z=~]+$/.test(arg)) {
          return arg;
        }
        return `'${arg.replace(/'/g, "\\'")}'`;
      })
      .join(' ')
    ;

    const goldenDiffSource = await this.cliArgs_.parseDiffBase();
    const snapshotDiffSource = await this.cliArgs_.parseDiffBase({
      rawDiffBase: 'HEAD',
    });

    const gitUserName = await this.gitRepo_.getUserName();
    const gitUserEmail = await this.gitRepo_.getUserEmail();
    const gitUser = `${gitUserName} &lt;${gitUserEmail}&gt;`;

    const getExecutableVersion = async (cmd) => {
      const options = {cwd: process.env.PWD, env: process.env};
      const stdOut = await childProcess.exec(`${cmd} --version`, options);
      return stdOut[0].trim();
    };

    const mdcVersion = require('../../../lerna.json').version;
    const mdcVersionDistance = await this.getCommitDistanceMarkup_(mdcVersion);
    const nodeVersion = await getExecutableVersion('node');
    const npmVersion = await getExecutableVersion('npm');

    return `
<details class="report-metadata" open>
  <summary class="report-metadata__heading">Metadata</summary>
  <div class="report-metadata__content">
    <table class="report-metadata__table">
      <tbody>
        <tr>
          <th class="report-metadata__cell report-metadata__cell--key">Timestamp:</th>
          <td class="report-metadata__cell report-metadata__cell--val">${timestamp}</td>
        </tr>
        <tr>
          <th class="report-metadata__cell report-metadata__cell--key">Screenshots:</th>
          <td class="report-metadata__cell report-metadata__cell--val">${numScreenshots}</td>
        </tr>
        <tr>
          <th class="report-metadata__cell report-metadata__cell--key">Test Cases:</th>
          <td class="report-metadata__cell report-metadata__cell--val">${numTestCases}</td>
        </tr>
        <tr>
          <th class="report-metadata__cell report-metadata__cell--key">Golden:</th>
          <td class="report-metadata__cell report-metadata__cell--val">
            ${await this.getCommitLinkMarkup_(goldenDiffSource)}
          </td>
        </tr>
        <tr>
          <th class="report-metadata__cell report-metadata__cell--key">Snapshot Base:</th>
          <td class="report-metadata__cell report-metadata__cell--val">
            ${await this.getCommitLinkMarkup_(snapshotDiffSource)}
            ${await this.getLocalChangesMarkup_(snapshotDiffSource)}
          </td>
        </tr>
        <tr>
          <th class="report-metadata__cell report-metadata__cell--key">User:</th>
          <td class="report-metadata__cell report-metadata__cell--val">${gitUser}</td>
        </tr>
        <tr>
          <th class="report-metadata__cell report-metadata__cell--key">MDC Version:</th>
          <td class="report-metadata__cell report-metadata__cell--val">${mdcVersion} ${mdcVersionDistance}</td>
        </tr>
        <tr>
          <th class="report-metadata__cell report-metadata__cell--key">Node Version:</th>
          <td class="report-metadata__cell report-metadata__cell--val">${nodeVersion}</td>
        </tr>
        <tr>
          <th class="report-metadata__cell report-metadata__cell--key">NPM Version:</th>
          <td class="report-metadata__cell report-metadata__cell--val">${npmVersion}</td>
        </tr>
        <tr>
          <th class="report-metadata__cell report-metadata__cell--key">CLI Invocation:</th>
          <td class="report-metadata__cell report-metadata__cell--val">${cliInvocation}</td>
        </tr>
      </tbody>
    </table>
  </div>
</details>
`;
  }

  /**
   * @param {!DiffSource} diffSource
   * @return {!Promise<string>}
   * @private
   */
  async getCommitLinkMarkup_(diffSource) {
    if (diffSource.publicUrl) {
      return `<a href="${diffSource.publicUrl}">${diffSource.publicUrl}</a>`;
    }

    if (diffSource.localFilePath) {
      return `${diffSource.localFilePath} (local file)`;
    }

    if (diffSource.gitRevision) {
      const rev = diffSource.gitRevision;

      if (rev.branch) {
        const branchDisplayName = rev.remote ? `${rev.remote}/${rev.branch}` : rev.branch;
        return `
<a href="${GITHUB_REPO_URL}/blob/${rev.commit}/${rev.snapshotFilePath}">${rev.commit}</a>
on branch
<a href="${GITHUB_REPO_URL}/blob/${rev.branch}/${rev.snapshotFilePath}">${branchDisplayName}</a>
`;
      }

      if (rev.tag) {
        return `
<a href="${GITHUB_REPO_URL}/blob/${rev.commit}/${rev.snapshotFilePath}">${rev.commit}</a>
on tag
<a href="${GITHUB_REPO_URL}/blob/${rev.tag}/${rev.snapshotFilePath}">${rev.tag}</a>
`;
      }
    }

    throw new Error('Unable to generate markup for invalid diff source');
  }

  /**
   * @param {string} mdcVersion
   * @return {!Promise<string>}
   */
  async getCommitDistanceMarkup_(mdcVersion) {
    const mdcCommitCount = (await this.gitRepo_.getLog([`v${mdcVersion}..HEAD`])).length;
    return mdcCommitCount > 0 ? `+ ${mdcCommitCount} commit${mdcCommitCount === 1 ? '' : 's'}` : '';
  }

  async getLocalChangesMarkup_() {
    const fragments = [];
    const gitStatus = await this.gitRepo_.getStatus();
    const numUntracked = gitStatus.not_added.length;
    const numModified = gitStatus.files.length - numUntracked;

    if (numModified > 0) {
      fragments.push(`${numModified} locally modified file${numModified === 1 ? '' : 's'}`);
    }

    if (numUntracked > 0) {
      fragments.push(`${numUntracked} untracked file${numUntracked === 1 ? '' : 's'}`);
    }

    return fragments.length > 0 ? `(${fragments.join(', ')})` : '';
  }

  getCollapseButtonMarkup_() {
    return `
<p>
  <button onclick="mdc.report.collapseAll()">
    collapse all
  </button>
</p>
`;
  }

  getDiffListMarkup_({changelist, map, showCheckboxes}) {
    const numDiffs = changelist.length;
    if (numDiffs === 0) {
      return '<div class="report-congrats">Woohoo! 🎉</div>';
    }

    const htmlFilePaths = Array.from(map.keys());
    return htmlFilePaths.map((htmlFilePath) => this.getTestCaseMarkup_({htmlFilePath, map, showCheckboxes})).join('\n');
  }

  getTestCaseMarkup_({htmlFilePath, map, showCheckboxes}) {
    const diffs = map.get(htmlFilePath);
    const goldenPageUrl = diffs[0].goldenPageUrl;
    const snapshotPageUrl = diffs[0].snapshotPageUrl;

    return `
<details class="report-file" open>
  <summary class="report-file__heading">
    ${this.getCheckboxMarkup_(showCheckboxes)}
    ${htmlFilePath}
    (<a href="${goldenPageUrl}">golden</a> | <a href="${snapshotPageUrl}">snapshot</a>)
  </summary>
  <div class="report-file__content">
    ${diffs.map((diff) => this.getDiffRowMarkup_({diff, showCheckboxes})).join('\n')}
  </div>
</details>
`;
  }

  getDiffRowMarkup_({diff, showCheckboxes}) {
    return `
<details class="report-browser" open
         data-mdc-html-file-path="${diff.htmlFilePath}"
         data-mdc-user-agent-alias="${diff.userAgentAlias}">
  <summary class="report-browser__heading">
    ${this.getCheckboxMarkup_(showCheckboxes)}
    ${diff.userAgentAlias}
  </summary>
  <div class="report-browser__content">
    ${this.getDiffCellMarkup_('Golden', diff.expectedImageUrl)}
    ${this.getDiffCellMarkup_('Diff', diff.diffImageUrl)}
    ${this.getDiffCellMarkup_('Snapshot', diff.actualImageUrl)}
  </div>
</details>
`;
  }

  getDiffCellMarkup_(description, url) {
    return `
<div class="report-browser__image-cell">
  ${description}:
  ${this.getDiffImageLinkMarkup_(url)}
</div>
`;
  }

  getDiffImageLinkMarkup_(url) {
    if (url) {
      return `
  <a href="${url}" class="report-browser__image-link">
    <img class="report-browser__image" src="${url}">
  </a>
`;
    }

    return '<div>(null)</div>';
  }

  getApprovalBarMarkup_() {
    const numChanges = this.reportJson_.testCases.length;
    const numDiffs = this.reportJson_.diffs.length;
    return `
<footer class="report-approval">
  <button class="report-approval__button" onclick="mdc.report.approveSelected()">
    Approve
    <span id="report-approval__total-count">${numChanges}</span>
    changes
    (CLI)
  </button>
  <button class="report-approval__button" ${numDiffs > 0 ? '' : 'disabled'} onclick="mdc.report.retrySelected()">
    Retry ${numDiffs} diffs
    (CLI)
  </button>
  <span class="report-approval__clipboard-notice report-approval__clipboard-notice--hidden"
        id="report-approval__clipboard-notice">
    Copied CLI command to clipboard!
  </span>
  <span class="report-approval__clipboard-content"
        id="report-approval__clipboard-content"></span>
</footer>    
`;
  }
}

module.exports = ReportGenerator;
