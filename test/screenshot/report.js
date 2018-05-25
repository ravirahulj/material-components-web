/*
 * Copyright 2018 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

window.mdc = window.mdc || {};
window.mdc.report = window.mdc.report || (() => {
  document.addEventListener('click', (evt) => {
    if (!evt.target.matches('input[type="checkbox"]')) {
      return;
    }

    let changelistElem;
    let fileElem;
    let browserElem;

    function updateChangelistCheckbox(targetElem) {
      changelistElem = targetElem.closest('.report-changelist');
      const changelistCheckboxElem = changelistElem.querySelector('.report-changelist__heading input[type="checkbox"]');

      const fileCheckboxElems = Array.from(
        changelistElem.querySelectorAll('.report-file__heading input[type="checkbox"')
      );
      const areSomeChecked = fileCheckboxElems.some((fileCheckboxElem) => {
        return fileCheckboxElem.checked && !fileCheckboxElem.indeterminate;
      });
      const areSomeUnchecked = fileCheckboxElems.some((fileCheckboxElem) => {
        return !fileCheckboxElem.checked || fileCheckboxElem.indeterminate;
      });

      changelistCheckboxElem.checked = areSomeChecked;
      changelistCheckboxElem.indeterminate = areSomeChecked && areSomeUnchecked;
    }

    function updateFileCheckbox(browserElem) {
      fileElem = browserElem.closest('.report-file');
      const fileCheckboxElem = fileElem.querySelector('.report-file__heading input[type="checkbox"]');

      const browserCheckboxElems = Array.from(
        fileElem.querySelectorAll('.report-browser__heading input[type="checkbox"')
      );
      const areSomeChecked = browserCheckboxElems.some((browserCheckboxElem) => {
        return browserCheckboxElem.checked && !browserCheckboxElem.indeterminate;
      });
      const areSomeUnchecked = browserCheckboxElems.some((browserCheckboxElem) => {
        return !browserCheckboxElem.checked || browserCheckboxElem.indeterminate;
      });

      fileCheckboxElem.checked = areSomeChecked;
      fileCheckboxElem.indeterminate = areSomeChecked && areSomeUnchecked;
    }

    function updateApprovalCounts() {
      const approvedBrowserCheckboxElems = Array.from(document.querySelectorAll(
        '.report-browser__heading input[type="checkbox"]:checked:not(:indeterminate)'
      ));
      const approvalCount = approvedBrowserCheckboxElems.length;
      const approvalCountElem = document.querySelector('#report-approval__total-count');
      const approvalButtonElem = approvalCountElem.closest('button');
      approvalCountElem.innerText = approvalCount;
      approvalButtonElem.disabled = approvalCount === 0;
    }

    browserElem = evt.target.closest('.report-browser');
    if (browserElem) {
      updateFileCheckbox(browserElem);
      updateChangelistCheckbox(browserElem);
      updateApprovalCounts();
      return;
    }

    fileElem = evt.target.closest('.report-file');
    if (fileElem) {
      Array.from(fileElem.querySelectorAll('input[type="checkbox"]')).forEach((checkboxElem) => {
        checkboxElem.indeterminate = false;
        checkboxElem.checked = evt.target.checked;
      });

      updateChangelistCheckbox(fileElem);
      updateApprovalCounts();

      return;
    }

    changelistElem = evt.target.closest('.report-changelist');
    if (changelistElem) {
      Array.from(changelistElem.querySelectorAll('input[type="checkbox"]')).forEach((checkboxElem) => {
        checkboxElem.indeterminate = false;
        checkboxElem.checked = evt.target.checked;
      });

      updateApprovalCounts();

      return;
    }
  });

  function collapseAll() {
    const detailsElems = Array.from(document.querySelectorAll('details'));
    const areAnyOpen = detailsElems.some((detailsElem) => detailsElem.open);
    detailsElems.forEach((detailsElem) => detailsElem.open = !areAnyOpen);
  }

  let approvalClipboardNoticeTimer;

  function getSelectedBrowserElems(type = '', inputSelector = '') {
    const checkboxElems = Array.from(document.querySelectorAll([
      `.report-changelist[data-mdc-changelist-type${type ? '="' + type+ '"' : ''}]`,
      '.report-browser__heading',
      `input[type="checkbox"]${inputSelector}:not(:indeterminate)`,
    ].join(' ')));
    return checkboxElems.map((checkboxElem) => checkboxElem.closest('.report-browser'));
  }

  function getChangelistArgs(type, flag) {
    const browserElems = getSelectedBrowserElems(type, ':checked');
    return browserElems.map((browserElem) => {
      const htmlFilePath = browserElem.getAttribute('data-mdc-html-file-path');
      const userAgentAlias = browserElem.getAttribute('data-mdc-user-agent-alias');
      return `${flag}='${htmlFilePath}:${userAgentAlias}'`;
    });
  }

  function getRetryArgs(type) {
    const htmlFilePathSet = new Set();
    const userAgentAliasSet = new Set();

    const browserElems = getSelectedBrowserElems(type, ':checked');
    browserElems.forEach((browserElem) => {
      const htmlFilePath = browserElem.getAttribute('data-mdc-html-file-path');
      const userAgentAlias = browserElem.getAttribute('data-mdc-user-agent-alias');
      htmlFilePathSet.add(`--mdc-include-url=${htmlFilePath}`);
      userAgentAliasSet.add(`--mdc-include-browser=${userAgentAlias}`);
    });

    return [
      ...Array.from(htmlFilePathSet),
      ...Array.from(userAgentAliasSet),
    ];
  }

  function approveSelected() {
    const reportJsonUrl = document.body.getAttribute('data-mdc-report-json-url');
    const changelistArgs = [
      ...getChangelistArgs('diff', '--mdc-approve-diff'),
      ...getChangelistArgs('added', '--mdc-approve-add'),
      ...getChangelistArgs('removed', '--mdc-approve-remove'),
    ];

    const areAllSelected = changelistArgs.length === getSelectedBrowserElems().length;
    const allArgs = areAllSelected
      ? [`--mdc-report-json-url='${reportJsonUrl}'`]
      : [`--mdc-report-json-url='${reportJsonUrl}'`, ...changelistArgs]
    ;
    const commandStr = `npm run screenshot:approve -- ${allArgs.join(' ')}`;

    const clipboardElem = document.querySelector('#report-approval__clipboard-content');
    clipboardElem.innerText = commandStr;
    const range = document.createRange();
    range.selectNode(clipboardElem);
    window.getSelection().addRange(range);

    try {
      // Now that we've selected the anchor text, execute the copy command
      const successful = document.execCommand('copy');
      const msg = successful ? 'successful' : 'unsuccessful';
      console.log('Copy command was ' + msg);
    } catch (err) {
      console.log('ERROR: Unable to copy to clipboard');
    }

    // Remove the selections - NOTE: Should use
    // removeRange(range) when it is supported
    window.getSelection().removeAllRanges();

    const clipboardNoticeElem = document.querySelector('#report-approval__clipboard-notice');
    clipboardNoticeElem.classList.remove('report-approval__clipboard-notice--hidden');
    clearTimeout(approvalClipboardNoticeTimer);
    approvalClipboardNoticeTimer = setTimeout(() => {
      clipboardNoticeElem.classList.add('report-approval__clipboard-notice--hidden');
    }, 4 * 1000);
  }

  function retrySelected() {
    const retryArgs = getRetryArgs('diff');
    const commandStr = `npm run screenshot:test -- ${retryArgs.join(' ')}`;

    const clipboardElem = document.querySelector('#report-approval__clipboard-content');
    clipboardElem.innerText = commandStr;
    const range = document.createRange();
    range.selectNode(clipboardElem);
    window.getSelection().addRange(range);

    try {
      // Now that we've selected the anchor text, execute the copy command
      const successful = document.execCommand('copy');
      const msg = successful ? 'successful' : 'unsuccessful';
      console.log('Copy command was ' + msg);
    } catch (err) {
      console.log('ERROR: Unable to copy to clipboard');
    }

    // Remove the selections - NOTE: Should use
    // removeRange(range) when it is supported
    window.getSelection().removeAllRanges();

    const clipboardNoticeElem = document.querySelector('#report-approval__clipboard-notice');
    clipboardNoticeElem.classList.remove('report-approval__clipboard-notice--hidden');
    clearTimeout(approvalClipboardNoticeTimer);
    approvalClipboardNoticeTimer = setTimeout(() => {
      clipboardNoticeElem.classList.add('report-approval__clipboard-notice--hidden');
    }, 4 * 1000);
  }

  return {
    collapseAll,
    approveSelected,
    retrySelected,
  };
})();
