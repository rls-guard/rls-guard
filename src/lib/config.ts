import { resolve } from 'path';
import { Config } from './rls-config';

export async function loadConfig(configPath: string): Promise<Config> {
    const absolutePath = resolve(configPath);
    
    try {
      // Use tsx to run the TypeScript file directly
      const { spawn } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(spawn);
      
      // Execute tsx to load and export the config
      const process = spawn('npx', ['tsx', '--eval', `
        import configBuilder from '${absolutePath}';
        console.log(JSON.stringify(configBuilder.build(), null, 2));
      `], { stdio: ['pipe', 'pipe', 'pipe'] });
      
      let stdout = '';
      let stderr = '';
      
      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      return new Promise((resolve, reject) => {
        process.on('close', (code) => {
          if (code === 0) {
            try {
              const config: Config = JSON.parse(stdout.trim());
              resolve(config);
            } catch (e) {
              reject(new Error(`Failed to parse configuration JSON: ${e instanceof Error ? e.message : e}`));
            }
          } else {
            reject(new Error(`Failed to load configuration: ${stderr || 'Unknown error'}`));
          }
        });
      });
      
    } catch (error) {
      throw new Error(`Failed to load configuration: ${error instanceof Error ? error.message : error}`);
    }
  }