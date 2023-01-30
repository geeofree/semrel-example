#!/usr/bin/env zx

import 'zx/globals';
import config from './config.mjs';

(async () => {
  const { SEMREL_DEBUG: DEBUG, GH_REPOSITORY, GH_TOKEN, GITHUB_TOKEN, GIT_COMMITTER_NAME, GIT_COMMITTER_EMAIL } = process.env;

  const TOKEN = GH_TOKEN || GITHUB_TOKEN

  if (!TOKEN) {
    throw '[ERROR] Please provide a github token.';
  }

  if (!GH_REPOSITORY) {
    throw '[ERROR] The github repository is required. Should contain: <repo_owner>/<repo_name>';
  }

  $.noquote = async (...args) => { const q = $.quote; $.quote = v => v; const p = $(...args); p; $.quote = q; return p }

  const GIT_COMMITTER = {
    name: GIT_COMMITTER_NAME || 'SemRel Bot',
    email: GIT_COMMITTER_EMAIL || 'semrel-bot@hotmail.com',
  }

  const [GH_REPO_OWNER, GH_REPO_NAME] = GH_REPOSITORY.split('/');
  const REPO_PUBLIC_URL = (await $`git config --get remote.origin.url`).toString().trim();

  const suffix = config.suffix ? `-${config.suffix}` : '';
  const semanticTagPattern = new RegExp(`^v?(\\d+).(\\d+).(\\d+)${suffix}$`);

  const tags = (await $`git tag -l --sort=-v:refname`).toString().split('\n').map(tag => tag.trim()).filter(Boolean);
  const latestTag = tags.find(tag => semanticTagPattern.test(tag));

  const COMMIT_INFO_DELIMITER = '____';
  const COMMIT_DELIMITER = '++++';
  const COMMIT_INFO = ['%s', '%b', '%h', '%H'].join(COMMIT_INFO_DELIMITER);
  const commitsRange = latestTag ? `${(await $`git rev-list -1 ${latestTag}`).toString().trim()}..HEAD`: 'HEAD';

  /**
    * @typedef Commit
    * @property {string} subject Subject of the commit message
    * @property {string?} body Body of the commit message
    * @property {string} short Abbreviated Hash ID
    * @property {string} hash Full Hash ID
    **/

  /** @typedef {Commit[]} Commits */

  /** @type Commits */
  const latestCommits = (await $.noquote`git log --format='${COMMIT_DELIMITER}${COMMIT_INFO}' ${commitsRange}`)
  .toString()
  .split(COMMIT_DELIMITER)
  .filter(Boolean)
  .map(commitMsg => {
    const [subject, body, short, hash] = commitMsg.split(COMMIT_INFO_DELIMITER).map(raw => raw.trim());
    return { subject, body, short, hash };
  });

  const semanticChanges = Object.keys(config['release-rules']).reduce((acc, versionSection) => {
    /** @type {import("./config.mjs").ReleaseRule} */
    const releaseRule = config['release-rules'][versionSection];

    if (!acc[versionSection]) {
      acc[versionSection] = [];
    }

    latestCommits.forEach(commit => {
      if (releaseRule['ends-with']) {
        const endsWithPrefix = releaseRule['ends-with'].some(prefix => {
          const endPrefix = new RegExp(`^\\w+(\\(\\w+\\))?${prefix}`);
          return endPrefix.test(commit.subject);
        });

        if (endsWithPrefix) {
          acc[versionSection] = [...acc[versionSection], commit];
        }

        return;
      }

      if (releaseRule['starts-with']) {
        const startsWithThePrefix = releaseRule['starts-with'].some(prefix => commit.subject.startsWith(prefix));

        if (startsWithThePrefix) {
          acc[versionSection] = [...acc[versionSection], commit];
        }
      }
    });

    return acc;
  }, {});

  const RELEASE_SEVERITY_ORDER = ['major', 'minor', 'patch'];

  const releaseNotes = RELEASE_SEVERITY_ORDER.map(versionSection => {
    /** @type {import("./config.mjs").ReleaseRule} */
    const { title } = config['release-rules'][versionSection];

    const commits = semanticChanges[versionSection];

    if (!commits.length) return;

    const notes = commits.map(commit => {
      const commitRef = `Commit Ref: [${commit.short}](${REPO_PUBLIC_URL.replace(/\.git$/, '')}/commit/${commit.hash})`
      /**
        * Release Note Format:
        * - <CommitSubject>
        *   <CommitBody>
        *   Commit Ref: <Link:CommitRef>
        **/
      const note = `- ## ${commit.subject}**\n\n  ${commit.body}\n\n  ${commitRef}`;
      return note;
    }).join('\n');

    const note = `# ${title}\n\n${notes}`;

    return note;
  }).filter(Boolean).join("\n\n");

  const nextReleaseType = RELEASE_SEVERITY_ORDER.find(versionSection => semanticChanges[versionSection].length);

  if (!nextReleaseType) {
    console.log('[INFO] No semantic changes found. Will not release.');
    return;
  }

  const nextVersion = ((latestTag, releaseType) => {
    if (!releaseType) return;

    if (!latestTag) return `${config['initial-version']}${suffix}`;

    const [, major, minor, patch] = semanticTagPattern.exec(latestTag);

    if (releaseType === 'major') return `${-~major}.0.0${suffix}`
    if (releaseType === 'minor') return `${major}.${-~minor}.0${suffix}`
    if (releaseType === 'patch') return `${major}.${minor}.${-~patch}${suffix}`

    throw `[ERROR] Invalid release type found: ${releaseType}`;
  })(latestTag, nextReleaseType);

  const nextTag = `v${nextVersion}`;
  const releaseMessage = `chore(release): ${nextTag}\n\n${releaseNotes}`;

  await $`git config user.name ${GIT_COMMITTER.name}`;
  await $`git config user.email ${GIT_COMMITTER.email}`;

  await $`git tag -a ${nextTag} -m ${releaseMessage}`;
  await $`git push origin ${nextTag}`;

  const releaseData = JSON.stringify({
    name: nextTag,
    tag_name: nextTag,
    body: releaseNotes,
    owner: GH_REPO_OWNER,
    repo: GH_REPO_NAME,
  });

  await $`
    curl \
      -X POST \
      -H "Accept: application/vnd.github+json" \
      -H "Authorization: Bearer ${TOKEN}"\
      -H "X-GitHub-Api-Version: 2022-11-28" \
      https://api.github.com/repos/${GH_REPO_OWNER}/${GH_REPO_NAME}/releases \
      -d ${releaseData}
  `

  if (DEBUG) {
    console.log({
      config,
      tags,
      latestTag,
      latestCommits,
      semanticChanges,
      releaseNotes,
      nextReleaseType,
      nextVersion,
    });
  }
})()
