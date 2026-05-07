#!/usr/bin/env node
import { spawn } from 'child_process';

console.log('Starting debug run...');

const child = spawn('node', ['--import', './loader.js', 'src/getGitRepo.ts'], {
