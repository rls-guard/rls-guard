import { pathToFileURL } from 'url'
import { Config, ConfigBuilder } from './rls-config';
import { TestPoliciesConfig } from './test-config';

async function _loadConfig<T>(configPath: string): Promise<T> {
  const fullPath = pathToFileURL(configPath).href
  const module = await import(fullPath)
  return module.default
}

export async function loadTestConfig(configPath: string): Promise<TestPoliciesConfig> {
  return await _loadConfig<TestPoliciesConfig>(configPath);
}

export async function loadConfig(configBuilderPath: string): Promise<Config> {
  const configBuilder = await _loadConfig<ConfigBuilder>(configBuilderPath);
  return configBuilder.build();
}