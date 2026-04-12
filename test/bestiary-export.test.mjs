import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const projectRoot = process.cwd();
const outputDir = path.join(projectRoot, 'output', 'bestiary');

test('prepareData exports bestiary json files with bilingual payloads', async () => {
  const run = spawnSync('node', ['--import', './loader.js', 'src/prepareData.ts'], {
    cwd: projectRoot,
    encoding: 'utf-8',
  });

  assert.equal(run.status, 0, `prepareData failed:\nSTDOUT:\n${run.stdout}\nSTDERR:\n${run.stderr}`);
  assert.equal(existsSync(outputDir), true, 'expected output/bestiary to exist');

  const files = await fs.readdir(outputDir);
  assert.ok(files.length > 0, 'expected output/bestiary to contain exported files');

  const aarakocraFile = files.find(file => file === 'bestiary_1_MM_1_Aarakocra.json');
  assert.ok(aarakocraFile, 'expected Aarakocra|MM sample file to be exported');

  const raw = await fs.readFile(path.join(outputDir, aarakocraFile), 'utf-8');
  const data = JSON.parse(raw);

  assert.equal(data.dataType, 'bestiary');
  assert.equal(data.id, 'Aarakocra|MM');
  assert.equal(data.uid, 'bestiary_Aarakocra|MM');
  assert.equal(data.source, 'MM');
  assert.equal(data.page, 12);
  assert.deepEqual(data.displayName, {
    zh: '鸟羽人',
    en: 'Aarakocra',
  });
  assert.ok(Array.isArray(data.referenceSources), 'expected referenceSources array');
  assert.ok(Array.isArray(data.allSources), 'expected allSources array');
  assert.ok(data.full, 'expected full fluff payload');
  assert.ok(data.en, 'expected en payload');
  assert.ok(data.zh, 'expected zh payload');
  assert.ok(data.en.action, 'expected action block under en');
  assert.ok(data.zh.action, 'expected action block under zh');
  assert.equal(data.action, undefined, 'expected localized action block to stay out of root');

  const solarDragonFile = files.find(file => file === 'bestiary_1_BAM_1_Solar Dragon.json');
  assert.ok(solarDragonFile, 'expected fluff-only Solar Dragon|BAM file to be exported');

  const solarDragonRaw = await fs.readFile(path.join(outputDir, solarDragonFile), 'utf-8');
  const solarDragon = JSON.parse(solarDragonRaw);

  assert.equal(solarDragon.dataType, 'bestiary');
  assert.equal(solarDragon.id, 'Solar Dragon|BAM');
  assert.equal(solarDragon.uid, 'bestiary_Solar Dragon|BAM');
  assert.equal(solarDragon.source, 'BAM');
  assert.equal(solarDragon.page, 0);
  assert.ok(solarDragon.full?.en, 'expected fluff-only record to include english full content');
  assert.ok(solarDragon.full?.zh, 'expected fluff-only record to include chinese full content');

  const chromaticDragonsFile = files.find(file => file === 'bestiary_1_MM_1_Chromatic Dragons.json');
  assert.ok(chromaticDragonsFile, 'expected Chromatic Dragons|MM file to be exported');

  const chromaticDragonsRaw = await fs.readFile(path.join(outputDir, chromaticDragonsFile), 'utf-8');
  const chromaticDragons = JSON.parse(chromaticDragonsRaw);
  assert.ok(chromaticDragons.full?.en, 'expected Chromatic Dragons|MM to include english full content');
  assert.ok(chromaticDragons.full?.zh, 'expected Chromatic Dragons|MM to include chinese full content');

  const kuoToaFiles = files.filter(
    file => file.startsWith('bestiary_1_HotB_1_Kuo-') && file.includes('Marauder')
  );
  assert.equal(kuoToaFiles.length, 2, 'expected both Kuo-toa/Kuo-Toa Marauder exports to exist');

  const kuoToaIds = new Set();
  for (const file of kuoToaFiles) {
    const rawJson = await fs.readFile(path.join(outputDir, file), 'utf-8');
    const parsed = JSON.parse(rawJson);
    kuoToaIds.add(parsed.id);
  }
  assert.deepEqual([...kuoToaIds].sort(), [
    'Kuo-Toa Marauder|HotB',
    'Kuo-toa Marauder|HotB',
  ]);
});
