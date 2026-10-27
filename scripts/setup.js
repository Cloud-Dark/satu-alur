#!/usr/bin/env node
/**
 * Setup script untuk ServiceOps AI
 * Menyalin cloud.config.example.js ke cloud.config.js jika belum ada
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.join(__dirname, '..', 'src')
const configFile = path.join(srcDir, 'cloud.config.js')
const exampleFile = path.join(srcDir, 'cloud.config.example.js')

console.log('🔧 ServiceOps AI Setup\n')

// Check if cloud.config.js exists
if (!fs.existsSync(configFile)) {
  if (fs.existsSync(exampleFile)) {
    fs.copyFileSync(exampleFile, configFile)
    console.log('✅ Created src/cloud.config.js from example')
    console.log('📝 Please edit src/cloud.config.js with your WorkBuddy Cloud config')
  } else {
    console.log('⚠️  Example config not found. Please create src/cloud.config.js manually.')
  }
} else {
  console.log('✅ src/cloud.config.js already exists')
}

console.log('\n📋 Next steps:')
console.log('   1. npm install')
console.log('   2. npm run dev')
console.log('   3. Open http://localhost:5173')
console.log('\n☁️  To activate WorkBuddy Cloud:')
console.log('   Ask your WorkBuddy AI assistant to activate cloud for this app')
