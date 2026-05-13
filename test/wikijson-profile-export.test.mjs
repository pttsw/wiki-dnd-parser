import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const projectRoot = process.cwd();

const readJson = async relativePath => {
  const filePath = path.join(projectRoot, relativePath);
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw);
};

const expectWikiContract = data => {
  assert.equal(typeof data.uid, 'string');
  assert.equal(typeof data.id, 'string');
  assert.equal(typeof data.dataType, 'string');
  assert.equal(typeof data.source, 'string');
  assert.equal(typeof data.page, 'number');
  assert.equal(typeof data.displayName, 'object');
  assert.equal(typeof data.mainSource, 'object');
  assert.ok(Array.isArray(data.allSources), 'expected allSources array');
  assert.ok('en' in data, 'expected en payload');
  assert.ok('zh' in data, 'expected zh payload');
};

test('prepareData exports remaining wiki json profile targets with stable contract', async () => {
  const run = spawnSync('node', ['--import', './loader.js', 'src/prepareData.ts'], {
    cwd: projectRoot,
    encoding: 'utf-8',
    env: {
      ...process.env,
      WIKI_SKIP_PAGE_GENERATION: '1',
    },
  });

  assert.equal(run.status, 0, `prepareData failed:\nSTDOUT:\n${run.stdout}\nSTDERR:\n${run.stderr}`);

  const racePath = 'output/race/race_1_DMG_1_Aarakocra.json';
  assert.equal(existsSync(path.join(projectRoot, racePath)), true, 'expected race export');
  const race = await readJson(racePath);
  expectWikiContract(race);
  assert.equal(race.dataType, 'race');
  assert.equal(race.id, 'Aarakocra|DMG');

  const backgroundPath = 'output/background/background_1_PHB_1_Acolyte.json';
  assert.equal(existsSync(path.join(projectRoot, backgroundPath)), true, 'expected background export');
  const background = await readJson(backgroundPath);
  expectWikiContract(background);
  assert.equal(background.dataType, 'background');
  assert.equal(background.id, 'Acolyte|PHB');

  const deityCollectionPath = 'output/collection/deityCollection.json';
  assert.equal(existsSync(path.join(projectRoot, deityCollectionPath)), true, 'expected deity collection');
  const deityCollection = await readJson(deityCollectionPath);
  assert.equal(deityCollection.type, 'deityCollection');
  assert.ok(deityCollection.data.some(item => item.id === 'Amaunator|SCAG'));

  const trapPath = 'output/trap/trap_1_BMT_1_Balance and Ruin.json';
  assert.equal(existsSync(path.join(projectRoot, trapPath)), true, 'expected trap export');
  const trap = await readJson(trapPath);
  expectWikiContract(trap);
  assert.equal(trap.dataType, 'trap');
  assert.equal(trap.id, 'Balance and Ruin|BMT');

  const hazardPath = 'output/hazard/hazard_1_DMG_1_Brown Mold.json';
  assert.equal(existsSync(path.join(projectRoot, hazardPath)), true, 'expected hazard export');
  const hazard = await readJson(hazardPath);
  expectWikiContract(hazard);
  assert.equal(hazard.dataType, 'hazard');
  assert.equal(hazard.id, 'Brown Mold|DMG');

  const diseaseCollectionPath = 'output/collection/diseaseCollection.json';
  assert.equal(existsSync(path.join(projectRoot, diseaseCollectionPath)), true, 'expected disease collection');
  const diseaseCollection = await readJson(diseaseCollectionPath);
  assert.equal(diseaseCollection.type, 'diseaseCollection');
  assert.ok(diseaseCollection.data.some(item => item.id === 'Cackle Fever|DMG'));

  const vehicleUpgradeCollectionPath = 'output/collection/vehicleUpgradeCollection.json';
  assert.equal(existsSync(path.join(projectRoot, vehicleUpgradeCollectionPath)), true, 'expected vehicleUpgrade collection');
  const vehicleUpgradeCollection = await readJson(vehicleUpgradeCollectionPath);
  assert.equal(vehicleUpgradeCollection.type, 'vehicleUpgradeCollection');
  assert.ok(vehicleUpgradeCollection.data.some(item => item.id === 'Acidic Bile Sprayer|BGDIA'));

  const classPath = 'output/class/class_1_PHB_1_Barbarian.json';
  assert.equal(existsSync(path.join(projectRoot, classPath)), true, 'expected class export');
  const klass = await readJson(classPath);
  expectWikiContract(klass);
  assert.equal(klass.dataType, 'class');
  assert.equal(klass.id, 'Barbarian|PHB');
  assert.ok(Array.isArray(klass.subclasses), 'expected subclasses array');

  const subclassPath = 'output/subclass/subclass_1_PHB_1_Path of the Berserker.json';
  assert.equal(existsSync(path.join(projectRoot, subclassPath)), true, 'expected subclass export');
  const subclass = await readJson(subclassPath);
  expectWikiContract(subclass);
  assert.equal(subclass.dataType, 'subclass');
  assert.equal(subclass.id, 'Path of the Berserker|PHB');
  assert.equal(subclass.superiorfork?.superior, 'Barbarian|PHB');
});
