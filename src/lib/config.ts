import { pathToFileURL } from 'url';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { Config, ConfigBuilder } from './rls-config.js';

async function _loadConfig<T>(configPath: string): Promise<T> {
  const resolvedPath = resolve(configPath);
  
  if (!existsSync(resolvedPath)) {
    throw new Error(`Configuration file not found: ${configPath}`);
  }
  
  // Check if it's a TypeScript file
  if (configPath.endsWith('.ts')) {
    return await loadTypeScriptConfig<T>(resolvedPath);
  } else {
    // Direct import for JavaScript files
    const fullPath = pathToFileURL(resolvedPath).href;
    const module = await import(fullPath);
    return module.default;
  }
}

/**
 * Load TypeScript configuration file using tsx
 */
async function loadTypeScriptConfig<T>(configPath: string): Promise<T> {
  return new Promise((resolve, reject) => {
    // Create a temporary script that imports and exports the config
    const script = `
      import config from '${pathToFileURL(configPath).href}';
      console.log(JSON.stringify(config));
    `;
    
    // Execute with tsx
    const child = spawn('npx', ['tsx', '--eval', script], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd()
    });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Failed to load TypeScript config: ${stderr || stdout}`));
        return;
      }
      
      try {
        // Parse the JSON output from the script
        const lines = stdout.trim().split('\n');
        const configJson = lines[lines.length - 1]; // Get last line (the JSON)
        const config = JSON.parse(configJson);
        resolve(config as T);
      } catch (error) {
        reject(new Error(`Failed to parse config output: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
    
    child.on('error', (error) => {
      reject(new Error(`Failed to execute tsx: ${error.message}`));
    });
  });
}

// export async function loadTestConfig(configPath: string): Promise<TestPoliciesConfig> {
//   return await _loadConfig<TestPoliciesConfig>(configPath);
// }

export async function loadConfig(configBuilderPath: string): Promise<Config> {
  const configBuilder = await _loadConfig<ConfigBuilder>(configBuilderPath);
  return configBuilder.config;
}