const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: {
    background: './src/background.ts',
    popup: './src/popup.ts'
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true
  },
  target: 'web',
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/
      }
    ]
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        { from: 'manifest.json' },
        { from: 'popup.html' },
        { from: 'popup.css' }
      ]
    })
  ]
};