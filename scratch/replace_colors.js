const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/App.jsx');
let content = fs.readFileSync(filePath, 'utf8');

const replacements = [
  ['#1e1e2e', '#191919'],
  ['#181825', '#121212'],
  ['#313244', '#252630'],
  ['#cdd6f4', '#e2e4ed'],
  ['#a6adc8', '#a5adce'],
  ['#89b4fa', '#babbf1'],
  ['#cba6f7', '#ca9ee6'],
  ['#a6e3a1', '#a6d189'],
  ['#f38ba8', '#e78284'],
  ['#f9e2af', '#e5c07b']
];

replacements.forEach(([oldColor, newColor]) => {
  const regex = new RegExp(oldColor, 'g');
  content = content.replace(regex, newColor);
});

fs.writeFileSync(filePath, content, 'utf8');
console.log('App.jsx color replacement completed successfully!');
