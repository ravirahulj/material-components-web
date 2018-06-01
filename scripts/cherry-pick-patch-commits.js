/**
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

/**
 * @fileoverview Identifies and cherry-picks commits that are not features and do not contain breaking changes.
 *
 * Defaults to operating against the latest non-pre-release tag, but a tag can be specified via command-line argument.
 * This will automatically attempt to cherry-pick appropriate commits since the tag, but will abort and skip any
 * cherry-picks that result in conflicts.
 *
 * Note that this does not create a branch - you will be in detached HEAD state. You can create a branch afterwards
 * if you want, via `git checkout -b <branchname>`.
 */

const args = process.argv.slice(2);

const parser = require('conventional-commits-parser');
const parserOpts = require('conventional-changelog-angular/parser-opts');
const simpleGit = require('simple-git/promise')();
const {execSync} = require('child_process');

const CONFLICT_MESSAGE = 'after resolving the conflicts, mark the corrected paths';

// Resolves to the most recent non-pre-release git tag.
async function getMostRecentTag() {
  const tags = await simpleGit.tags();
  // Filter old independent-versioned tags and pre-releases
  const filteredTags = tags.all.filter((tag) => /^v/.test(tag) && !/-/.test(tag));
  return filteredTags[filteredTags.length - 1];
}

// Resolves to an array of commits after the given tag, from earliest to latest (for proper cherry-picking).
async function getCommitsAfterTag(tag) {
  await simpleGit.fetch();
  const log = await simpleGit.log({from: tag, to: 'origin/master'});
  return log.all.reverse();
}

async function attemptCherryPicks(tag, list) {
  const results = {
    successful: [],
    conflicted: [],
    skipped: [],
  }

  console.log(`Checking out ${tag}`)
  await simpleGit.checkout([tag]);

  for (let logLine of list) {
    const parsedCommit = parser.sync(logLine.message, parserOpts);
    if (parsedCommit.type === 'feat' || parsedCommit.notes.find((note) => title === 'BREAKING CHANGE')) {
      results.skipped.push(logLine);
      continue;
    }

    try {
      await simpleGit.raw(['cherry-pick', '-x', logLine.hash]);
      results.successful.push(logLine);
    } catch (e) {
      if (e.message.includes(CONFLICT_MESSAGE)) {
        results.conflicted.push(logLine);
        await simpleGit.raw(['cherry-pick', '--abort']);
      } else {
        console.error(`${logLine.hash} unexpected failure!`, e);
      }
    }
  }

  return results;
}

async function run() {
  const tag = args.find((arg) => arg[0] === 'v') || await getMostRecentTag();
  const list = await getCommitsAfterTag(tag);
  console.log(`Found ${list.length} commits after tag ${tag}`);

  const results = await attemptCherryPicks(tag, list);

  console.log('Finished cherry-picking commits!');
  console.log(`${results.successful.length} cherry-picked,`);
  console.log(`${results.conflicted.length} could not be cherry-picked without conflicts,`);
  console.log(`${results.skipped.length} skipped due to features or breaking changes`);

  if (results.conflicted.length) {
    console.log('');
    console.log('Commits with conflicts:');
    for (logLine of results.conflicted) {
      console.log(`- ${logLine.hash.slice(0, 8)} ${logLine.message.split('\n', 1)[0]}`);
    }
    console.log('Please examine these commits, determine if they should be cherry-picked, and do so manually.')
  }

  console.log('');
  console.log('Test-running build...')
  try {
    execSync('npm run build');
    console.log('Success!');
  } catch (e) {
    console.error('Build FAILED, see error above');
  }

  console.log('Running unit tests...')
  try {
    execSync('npm run test:unit');
    console.log('Success!');
  } catch (e) {
    console.error('Unit tests FAILED, see error above');
  }

  console.log('');
  console.log('Please review `git log` to make sure there are no commits dependent on omitted feature commits.');
}

run();
