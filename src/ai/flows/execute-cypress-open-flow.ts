
'use server';
/**
 * @fileOverview Saves a Cypress test file and attempts to run Cypress headlessly.
 *
 * - executeCypressRunHeadless - Saves the test and runs `cypress run --spec <spec>`.
 * - ExecuteCypressRunHeadlessInput - Input type for the flow.
 * - ExecuteCypressRunHeadlessOutput - Output type for the flow.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

const ExecuteCypressRunHeadlessInputSchema = z.object({
  testCode: z.string().describe('The Cypress test code to be saved and executed.'),
  repoPath: z.string().describe('The absolute local path to the cloned repository (Cypress project root).'),
  specFileName: z.string().describe('The desired file name for the spec, e.g., "user-login.cy.ts".'),
});
export type ExecuteCypressRunHeadlessInput = z.infer<typeof ExecuteCypressRunHeadlessInputSchema>;

const ExecuteCypressRunHeadlessOutputSchema = z.object({
  status: z.enum(['completed_successfully', 'completed_with_failures', 'error_running', 'error_saving_file'])
    .describe('Status of the Cypress headless run attempt.'),
  message: z.string().describe('A message detailing the outcome.'),
  specPath: z.string().optional().describe('The full path to the saved spec file.'),
  runSummary: z.string().optional().describe('Summary of the test run from Cypress output (e.g., pass/fail counts).'),
  detailedLog: z.string().optional().describe('More detailed log in case of an error during launch or run.'),
});
export type ExecuteCypressRunHeadlessOutput = z.infer<typeof ExecuteCypressRunHeadlessOutputSchema>;

async function executeCypressRunHeadlessLogic(input: ExecuteCypressRunHeadlessInput): Promise<ExecuteCypressRunHeadlessOutput> {
  const { testCode, repoPath, specFileName } = input;

  if (!fs.existsSync(repoPath)) {
    return {
      status: 'error_saving_file',
      message: `Repository path does not exist: ${repoPath}`,
      detailedLog: `Repository path check failed for: ${repoPath}`,
    };
  }

  const cypressE2eDir = path.join(repoPath, 'cypress', 'e2e');
  const specFilePath = path.join(cypressE2eDir, specFileName);

  try {
    if (!fs.existsSync(cypressE2eDir)) {
      fs.mkdirSync(cypressE2eDir, { recursive: true });
    }
    fs.writeFileSync(specFilePath, testCode, 'utf8');
  } catch (error: any) {
    return {
      status: 'error_saving_file',
      message: `Failed to save test file at ${specFilePath}: ${error.message}`,
      detailedLog: `File save error: ${error.message}\n${error.stack || ''}`,
      specPath: specFilePath,
    };
  }

  const relativeSpecPath = path.join('cypress', 'e2e', specFileName);

  return new Promise((resolve) => {
    let stdoutData = '';
    let stderrData = '';
    
    const cypressProcess = spawn('npx', ['cypress', 'run', '--spec', relativeSpecPath], {
      cwd: repoPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DISPLAY: '' }, // Attempt to force truly headless operation
    });

    cypressProcess.stdout?.on('data', (data) => {
      stdoutData += data.toString();
    });

    cypressProcess.stderr?.on('data', (data) => {
      stderrData += data.toString();
    });

    cypressProcess.on('error', (err) => { 
      resolve({
        status: 'error_running',
        message: `Failed to start Cypress headless run: ${err.message}.`,
        detailedLog: `Spawn error: ${err.message}\nEnsure Cypress is installed and configured.\nStderr (if any):\n${stderrData}`,
        specPath: specFilePath,
      });
    });

    cypressProcess.on('close', (code) => { 
      const fullLog = `Exit Code: ${code}\n\nStdout:\n${stdoutData}\n\nStderr:\n${stderrData}`;
      
      // Explicitly check for Xvfb error in stderr, as this is a recurring issue.
      if (stderrData.toLowerCase().includes('xvfb') && stderrData.toLowerCase().includes('missing the dependency')) {
         resolve({
           status: 'error_running',
           message: `Cypress Headless Run Failed: Xvfb dependency still reported even with DISPLAY=''. This suggests a deep-seated issue with Cypress/Electron on your system or an incorrect Cypress configuration.`,
           detailedLog: `Xvfb error detected in stderr during headless run attempt with DISPLAY=''.\n${fullLog.substring(0,1500)}`, // Truncate log for brevity
           specPath: specFilePath,
       });
       return;
      }

      if (code === 0 && (stdoutData.includes('All specs passed!') || stdoutData.match(/\(\d+ passing\)/))) {
        resolve({
          status: 'completed_successfully',
          message: `Cypress headless run for spec: ${relativeSpecPath} completed successfully.`,
          specPath: specFilePath,
          runSummary: stdoutData.substring(stdoutData.lastIndexOf('Run Summary'), stdoutData.lastIndexOf('Done running') !== -1 ? stdoutData.lastIndexOf('Done running') : undefined ) || 'Tests passed.',
          detailedLog: fullLog.substring(0,1500),
        });
      } else if (code !== 0 || stdoutData.match(/\(\d+ failing\)/) || (stderrData.trim() !== '' && !stderrData.toLowerCase().includes('xvfb'))) { 
        const failureMessage = stderrData.trim() !== '' && !stderrData.toLowerCase().includes('xvfb') ? 
            `Cypress headless run for spec: ${relativeSpecPath} likely failed. Check logs.` :
            `Cypress headless run for spec: ${relativeSpecPath} completed with failures or errors. Exit code: ${code}.`;
        resolve({
          status: 'completed_with_failures',
          message: failureMessage,
          specPath: specFilePath,
          runSummary: stdoutData.substring(stdoutData.lastIndexOf('Run Summary'), stdoutData.lastIndexOf('Done running') !== -1 ? stdoutData.lastIndexOf('Done running') : undefined ) || 'Tests completed with failures/errors.',
          detailedLog: fullLog.substring(0,1500),
        });
      } else { 
        resolve({
            status: 'error_running',
            message: `Cypress headless run for spec: ${relativeSpecPath} finished with an unknown status. Exit code: ${code}.`,
            specPath: specFilePath,
            detailedLog: fullLog.substring(0,1500),
        });
      }
    });
  });
}

export const executeCypressRunHeadless = ai.defineFlow(
  {
    name: 'executeCypressRunHeadlessFlow',
    inputSchema: ExecuteCypressRunHeadlessInputSchema,
    outputSchema: ExecuteCypressRunHeadlessOutputSchema,
  },
  executeCypressRunHeadlessLogic
);
