module.exports = {
    root: true,
    parser: '@typescript-eslint/parser',
    plugins: [
        '@typescript-eslint'
    ],
    extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended'
    ],
    rules: {
        'linebreak-style': ['error', 'unix'],
        '@typescript-eslint/prefer-namespace-keyword': 'off',
        '@typescript-eslint/no-namespace': 'off',
        '@typescript-eslint/no-inferrable-types': 'off',
        'guard-for-in': 'warn',
        '@typescript-eslint/await-thenable': 'warn',
        '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
        '@typescript-eslint/no-explicit-any': 'off'
    },
    parserOptions: {
        ecmaVersion: 2020,
        project: './tsconfig.json',
    },
}
