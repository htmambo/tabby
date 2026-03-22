import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FlatCompat } from '@eslint/eslintrc'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const compat = new FlatCompat({
    baseDirectory: __dirname,
    resolvePluginsRelativeTo: __dirname,
})

const baseLegacyConfig = {
    settings: {
        'import/parsers': {
            '@typescript-eslint/parser': ['.ts'],
        },
        'import/resolver': {
            typescript: {
                project: [
                    'tsconfig.json',
                    'tabby-*/tsconfig.json',
                ],
            },
            node: true,
        },
    },
    env: {
        browser: true,
        es6: true,
        node: true,
        commonjs: true,
    },
    overrides: [
        {
            files: '*.mjs',
            plugins: ['import'],
            parserOptions: {
                sourceType: 'module',
                ecmaVersion: 'latest',
            },
        },
        {
            files: '*.ts',
            parser: '@typescript-eslint/parser',
            parserOptions: {
                project: [
                    'tsconfig.json',
                    '*/tsconfig.typings.json',
                ],
            },
            extends: [
                'plugin:@typescript-eslint/all',
                'plugin:import/recommended',
                'plugin:import/typescript',
            ],
            plugins: [
                '@typescript-eslint',
                'import',
            ],
            rules: {
                '@typescript-eslint/explicit-member-accessibility': [
                    'error',
                    {
                        accessibility: 'no-public',
                        overrides: {
                            parameterProperties: 'explicit',
                        },
                    },
                ],
                '@typescript-eslint/no-require-imports': 'off',
                '@typescript-eslint/explicit-function-return-type': 'off',
                '@typescript-eslint/no-explicit-any': 'warn',
                '@typescript-eslint/no-magic-numbers': 'off',
                '@typescript-eslint/promise-function-async': 'off',
                '@typescript-eslint/require-array-sort-compare': 'off',
                '@typescript-eslint/no-floating-promises': 'warn',
                '@typescript-eslint/prefer-readonly': 'warn',
                '@typescript-eslint/require-await': 'warn',
                '@typescript-eslint/strict-boolean-expressions': 'warn',
                '@typescript-eslint/max-params': 'off',
                '@typescript-eslint/prefer-destructuring': 'off',
                '@typescript-eslint/no-misused-promises': [
                    'error',
                    {
                        checksVoidReturn: false,
                    },
                ],
                '@typescript-eslint/typedef': 'off',
                '@typescript-eslint/consistent-type-imports': 'off',
                '@typescript-eslint/no-use-before-define': [
                    'error',
                    {
                        classes: false,
                    },
                ],
                'no-duplicate-imports': 'error',
                semi: [
                    'error',
                    'never',
                ],
                'array-bracket-spacing': [
                    'error',
                    'never',
                ],
                'block-scoped-var': 'error',
                'brace-style': [
                    'error',
                    '1tbs',
                    {
                        allowSingleLine: true,
                    },
                ],
                'computed-property-spacing': [
                    'error',
                    'never',
                ],
                'comma-dangle': [
                    'error',
                    'always-multiline',
                ],
                curly: 'error',
                'eol-last': 'error',
                eqeqeq: [
                    'error',
                    'smart',
                ],
                'max-depth': [
                    1,
                    5,
                ],
                'max-statements': [
                    1,
                    80,
                ],
                'no-multiple-empty-lines': 'error',
                'no-mixed-spaces-and-tabs': 'error',
                'no-trailing-spaces': 'error',
                indent: [
                    'error',
                    4,
                ],
                '@typescript-eslint/no-unused-vars': [
                    'error',
                    {
                        vars: 'all',
                        args: 'after-used',
                        argsIgnorePattern: '^_',
                    },
                ],
                'no-undef': 'off',
                'no-var': 'error',
                'object-curly-spacing': [
                    'error',
                    'always',
                ],
                'quote-props': [
                    'warn',
                    'as-needed',
                    {
                        keywords: true,
                        numbers: true,
                    },
                ],
                quotes: [
                    'error',
                    'single',
                    {
                        allowTemplateLiterals: true,
                    },
                ],
                '@typescript-eslint/no-confusing-void-expression': [
                    'error',
                    {
                        ignoreArrowShorthand: true,
                    },
                ],
                '@typescript-eslint/no-non-null-assertion': 'off',
                '@typescript-eslint/no-unnecessary-condition': 'off',
                '@typescript-eslint/restrict-template-expressions': 'off',
                '@typescript-eslint/prefer-readonly-parameter-types': 'off',
                '@typescript-eslint/no-unsafe-member-access': 'off',
                '@typescript-eslint/no-unsafe-call': 'off',
                '@typescript-eslint/no-unsafe-return': 'off',
                '@typescript-eslint/no-unsafe-assignment': 'off',
                '@typescript-eslint/no-unsafe-enum-comparison': 'off',
                '@typescript-eslint/naming-convention': 'off',
                'lines-between-class-members': [
                    'error',
                    'always',
                    {
                        exceptAfterSingleLine: true,
                    },
                ],
                '@typescript-eslint/dot-notation': 'off',
                '@typescript-eslint/member-ordering': 'warn',
                '@typescript-eslint/no-var-requires': 'off',
                '@typescript-eslint/no-unsafe-argument': 'off',
                '@typescript-eslint/restrict-plus-operands': 'off',
                '@typescript-eslint/no-type-alias': [
                    'error',
                    {
                        allowAliases: 'in-unions-and-intersections',
                        allowLiterals: 'always',
                        allowCallbacks: 'always',
                    },
                ],
                '@typescript-eslint/sort-type-constituents': 'off',
                '@typescript-eslint/parameter-properties': [
                    'error',
                    {
                        prefer: 'parameter-property',
                    },
                ],
                'import/no-named-as-default-member': 'off',
                '@typescript-eslint/consistent-type-exports': 'off',
                '@typescript-eslint/consistent-generic-constructors': 'off',
                'keyword-spacing': 'off',
                '@typescript-eslint/class-methods-use-this': 'off',
                '@typescript-eslint/no-empty-function': 'off',
                '@typescript-eslint/no-redundant-type-constituents': 'off',
                '@typescript-eslint/no-extraneous-class': 'off',
                '@typescript-eslint/no-unnecessary-type-assertion': 'off',
                '@typescript-eslint/prefer-find': 'off',
                '@typescript-eslint/prefer-promise-reject-errors': 'off',
                '@typescript-eslint/prefer-regexp-exec': 'off',
            },
        },
    ],
}

const progressiveLegacyConfig = {
    overrides: [
        {
            files: [
                'app/src/**/*.ts',
                'tabby-core/src/**/*.ts',
            ],
            rules: {
                '@typescript-eslint/no-floating-promises': 'error',
                '@typescript-eslint/require-await': 'error',
            },
        },
    ],
}

const config = [
    ...compat.config(baseLegacyConfig),
]

if (process.env.TABBY_LINT_PROGRESSIVE === 'true') {
    config.push(...compat.config(progressiveLegacyConfig))
}

export default config
