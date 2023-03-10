
import 'zx/globals';

/**
  * @typedef ReleaseRule
  * @property {string} title Title of the release note for this change
  * @property {string[]} starts-with Prefixes for commits subjects to start with.
  * @property {string[]?} ends-with Prefixes for commits subjects to end with. Takes precedence over `starts-with` if provided.
/**
  * @typedef ReleaseRules
  * @property {ReleaseRule} major
  * @property {ReleaseRule} minor
  * @property {ReleaseRule} patch
  **/

/**
  * @typedef SemRelConfig
  * @property {string} initial-version
  * @property {boolean?} dry-run
  * @property {string?} jira-url
  * @property {boolean?} validate-jira-links
  * @property {string?} suffix
  * @property {ReleaseRules} release-rules
  **/

/** @type SemRelConfig */
let config = {
  'initial-version': '1.0.0',
  'dry-run': false,
  'jira-url': null,
  'validate-jira-links': false,
  suffix: null,
  'release-rules': {
    major: {
      title: 'BREAKING CHANGES',
      'ends-with': ['!'],
    },
    minor: {
      title: 'New Features',
      'starts-with': ['feat', 'feature'],
    },
    patch: {
      title: 'Bug Fixes',
      'starts-with': ['fix', 'perf', 'refactor'],
    }
  }
}

let configFilePaths = ['.release.yaml', '.release.yml'].map(fileName => {
  const filePath = path.resolve(__dirname, '..', fileName);
  return fs.pathExists(filePath).then(exists => exists ? filePath : null);
});

configFilePaths = await Promise.all(configFilePaths);

const configFilePath = configFilePaths.find(filePath => filePath);

if (configFilePath) {
  const yamlFile = await fs.readFile(configFilePath, 'utf-8');
  const yamlConfig = YAML.parse(yamlFile);
  config = {
    ...config,
    ...yamlConfig,
    'release-rules': {
      ...config['release-rules'],
    }
  };

  if (yamlConfig['release-rules']) {
    config = {
      ...config,
      'release-rules': {
        ...config['release-rules'],
        major: {
          ...config['release-rules'].major,
          ...yamlConfig['release-rules'].major,
        },
        minor: {
          ...config['release-rules'].minor,
          ...yamlConfig['release-rules'].minor,
        },
        patch: {
          ...config['release-rules'].patch,
          ...yamlConfig['release-rules'].patch,
        },
      }
    }
  }
} else {
  console.log('[INFO] No config file found.');
}

const validArgs = [
  'suffix', 's',
  'initial-version', 'i',
  'jira-url', 'ju',
  'dry-run', 'd',
  'validate-jira-links'
];

const argAliases = {
  s: 'suffix',
  i: 'initial-version',
  ju: 'jira-url',
  d: 'dry-run',
}

const args = Object.keys(argv).filter(arg => validArgs.includes(arg)).reduce((acc, arg) => {
  let value = argv[arg];

  if (argAliases[arg]) {
    acc[argAliases[arg]] = value;
  } else {
    acc[arg] = value;
  }

  return acc;
}, {});

config = {
  ...config,
  ...args,
  'release-rules': {
    ...config['release-rules']
  }
};

export default config;
