'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { runSamples } = require('../src/runner');

test('C++17 compiler runs empty and nonempty sample input', {
  skip: !process.env.HYDRO_TEST_COMPILER
}, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hydro-runner-test-'));
  try {
    const source = path.join(dir, 'main.cpp');
    await fs.writeFile(source, '#include <iostream>\nint main(){int x;if(std::cin>>x)std::cout<<x+1;else std::cout<<"Hello,World!";}\n');
    const result = await runSamples(source, [
      { id: 1, input: '', output: 'Hello,World!' },
      { id: 2, input: '5', output: '6' }
    ], process.env.HYDRO_TEST_COMPILER, 3000);
    assert.equal(result.compile.code, 0, result.compile.stderr);
    assert.deepEqual(result.cases.map(item => item.passed), [true, true]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
