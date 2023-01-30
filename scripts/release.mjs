#!/usr/bin/env zx

import 'zx/globals';
import config from './config.mjs';

(async () => {
  const { SEMREL_DEBUG: DEBUG, GH_REPOSITORY, GH_TOKEN, GITHUB_TOKEN, GIT_COMMITTER_NAME, GIT_COMMITTER_EMAIL } = process.env;

  const TOKEN = GH_TOKEN || GITHUB_TOKEN

  if (!TOKEN && !config['dry-run']) {
    throw '[ERROR] Please provide a github token.';
  }

  if (!GH_REPOSITORY && !config['dry-run']) {
    throw '[ERROR] The github repository is required. Should contain: <repo_owner>/<repo_name>';
  }

  $.noquote = async (...args) => { const q = $.quote; $.quote = v => v; const p = $(...args); p; $.quote = q; return p }

  const GIT_COMMITTER = {
    name: GIT_COMMITTER_NAME || 'SemRel Bot',
    email: GIT_COMMITTER_EMAIL || 'semrel-bot@hotmail.com',
  }

  const [GH_REPO_OWNER, GH_REPO_NAME] = (GH_REPOSITORY || '').split('/');
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

  /**
    * @param {Commit} commit
    * @returns {[string, string?]} A tuple containing the scope and the jira ticket url
    **/
  const getJiraTicketURL = (commit) => {
    const SCOPE_REGEX = new RegExp('^\\w+(\\((\\w|-)+\\))?:(.)+');
    const scope = commit.subject.replace(SCOPE_REGEX, '$1').replace(/\(|\)/g, '');
    let jiraTicketURL = null

    if (config['jira-url'] && scope) {
      jiraTicketURL = `${config['jira-url']}/${scope}`;
    }

    return [scope, jiraTicketURL];
  };

  if (config['validate-jira-links']) {
    const invalidScopesPromises = RELEASE_SEVERITY_ORDER.reduce((acc, versionSection) => {
      const commits = semanticChanges[versionSection];
      const scopeChecks = commits.map(commit => {
        const [scope, ticketURL] = getJiraTicketURL(commit);
        if (!ticketURL) return;
        return $.noquote`curl --head --silent --fail ${ticketURL} -w "scope: ${scope} url: %{url} status-code: %{http_code}\n" -o /dev/null 2> /dev/null`;
      }).filter(Boolean);
      return acc.concat(scopeChecks);
    }, []);

    // Check if any of the scopes contains a valid Jira URL
    if (invalidScopesPromises.length) {
      try {
        await Promise.all(invalidScopesPromises);
      } catch (error) {
        console.error(`[ERROR] Invalid scope: A jira link for a scope did not exist:\n\n${error.stdout}`);
        return;
      }
    }
  }

  const releaseNotes = RELEASE_SEVERITY_ORDER.map(versionSection => {
    /** @type {import("./config.mjs").ReleaseRule} */
    const { title } = config['release-rules'][versionSection];

    const commits = semanticChanges[versionSection];

    if (!commits.length) return;

    const notes = commits.map(commit => {
      const commitRef = `Commit Ref: [${commit.short}](${REPO_PUBLIC_URL.replace(/\.git$/, '')}/commit/${commit.hash})`
      const [scope, jiraTicketURL] = getJiraTicketURL(commit);

      /**
        * Release Note Format:
        * - ## <CommitSubject>
        *
        *   <CommitBody>
        *
        *   Commit Ref: <Link:CommitRef>
        *
        *   [<TicketUrl>]
        **/
      const contents = [`- ## ${commit.subject}`, commit.body, commitRef]

      if (jiraTicketURL) {
        const jiraTicketURLText = `Ticket: [${scope}](${jiraTicketURL})`;
        contents.push(jiraTicketURLText);
      }

      return contents.join("\n\n  ");
    }).join('\n');

    const note = `# ${title}\n\n${notes}`;

    return note;
  }).filter(Boolean).join("\n\n");

  const nextTag = `v${nextVersion}`;
  const releaseMessage = `chore(release): ${nextTag}\n\n${releaseNotes}`;

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

  if (config['dry-run']) {
    return console.log("[INFO] Dry-run is on. Won't be releasing changes.");
  }

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
})()
