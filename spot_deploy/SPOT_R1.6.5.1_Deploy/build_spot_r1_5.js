const fs = require('fs');
const babel = require('@babel/core');

let jsx = fs.readFileSync('./spot_r1_5.jsx', 'utf8');
console.log(`Read ${jsx.length} chars from spot_r1_5.jsx`);

// Strip ES module import — React is loaded globally via CDN
jsx = jsx.replace(
  'import React, { useState, useMemo, useCallback, useEffect } from "react";',
  'var { useState, useMemo, useCallback, useEffect } = React;'
);

// Strip ES module export — plain <script> tags can't use export syntax
jsx = jsx.replace('export default function App()', 'function App()');

// Verify both strips worked
if (jsx.includes('import ') && jsx.match(/^import /m)) {
  console.error('WARNING: Remaining import statement found!');
}
if (jsx.includes('export default')) {
  console.error('WARNING: Remaining export default found!');
}

const result = babel.transformSync(jsx, {
  presets: [
    ['@babel/preset-react', { pragma: 'React.createElement', pragmaFrag: 'React.Fragment' }],
    ['@babel/preset-env', { targets: { ie: '11' }, modules: false }]
  ],
  filename: 'spot_r1_5.jsx',
  compact: false
});

// Append React mount call
const code = result.code + '\nReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));\n';

console.log(`Transpiled to ${code.length} chars`);

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SPOT R1.6.5.1</title>
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<meta http-equiv="Pragma" content="no-cache">
<meta http-equiv="Expires" content="0">
<link rel="icon" type="image/png" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjws/f1AAAAAJcEhZcwAADsMAAA7DAcdvqGQAAABhSURBVFhH7c0xDQAgEAQxuMH/z6ECQkLB7iZTPnMAAICfRURk775X3TtI1b0D+N7vO0jVvYPsXZ+qewepuncA3/t9B6m6d5C961N17yBV9w7ge7/vIFX3DrJ3fQAA+E3EE0B6E0F1IhW+AAAAAElFTkSuQmCC">
<script crossorigin src="https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js"></script>
<script crossorigin src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js"></script>
</head>
<body>
<div id="root"></div>
<script>
${code}
</script>
</body>
</html>`;

fs.writeFileSync('./SPOT_R1.5.html', html);
console.log(`Built SPOT_R1.5.html (${(html.length/1024).toFixed(0)} KB)`);
