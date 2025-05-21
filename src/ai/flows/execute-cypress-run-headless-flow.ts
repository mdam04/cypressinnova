
'use server';
/**
 * @fileOverview Saves a Cypress test file and attempts to run Cypress headlessly,
 * trying Chrome first, then Firefox if Chrome encounters Xvfb issues.
 *
 * - executeCypressRunHeadless - Saves the test and runs `cypress run --headless --browser <browser> --spec <spec>`.
 * - ExecuteCypressRunHeadlessInput - Input type for the flow.
 * - ExecuteCypressRunHeadlessOutput - Output type for the flow.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import * as fs from 'fs';
import type { StdioOptions } from 'child_process';
import { spawn } from 'child_process';
import * as path from 'path';

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
  detailedLog: z.string().optional().describe('More detailed log, potentially including multiple attempts.'),
});
export type ExecuteCypressRunHeadlessOutput = z.infer<typeof ExecuteCypressRunHeadlessOutputSchema>;


// Helper function to attempt a single Cypress run configuration
async function tryCypressRunAttempt(
  cypressArgs: string[],
  spawnOptions: { cwd: string; stdio: StdioOptions; env: Record<string, string | undefined> },
  specFilePath: string,
  relativeSpecPath: string,
  browserName: string
): Promise<{ status: 'ok' | 'error_xvfb' | 'error_generic'; output: ExecuteCypressRunHeadlessOutput; log: string }> {
  return new Promise((resolve) => {
    let stdoutData = '';
    let stderrData = '';
    let attemptLog = `Attempting with ${browserName}: npx cypress ${cypressArgs.join(' ')}\n`;

    const cypressProcess = spawn('npx', ['cypress', ...cypressArgs], spawnOptions);

    cypressProcess.stdout?.on('data', (data) => {
      const line = data.toString();
      stdoutData += line;
      attemptLog += `STDOUT: ${line.substring(0, 200).trimEnd()}\n`;
    });

    cypressProcess.stderr?.on('data', (data) => {
      const line = data.toString();
      stderrData += line;
      attemptLog += `STDERR: ${line.substring(0, 200).trimEnd()}\n`;
    });

    cypressProcess.on('error', (err) => {
      attemptLog += `Spawn error for ${browserName}: ${err.message}\n`;
      resolve({
        status: 'error_generic',
        log: attemptLog,
        output: {
          status: 'error_running',
          message: `Failed to start Cypress run with ${browserName}: ${err.message}.`,
          detailedLog: `${attemptLog}Spawn error: ${err.message}\nEnsure Cypress is installed.\nStderr (if any):\n${stderrData}`,
          specPath: specFilePath,
        }
      });
    });

    cypressProcess.on('close', (code) => {
      const fullLog = `Browser: ${browserName}\nExit Code: ${code}\n\nStdout:\n${stdoutData}\n\nStderr:\n${stderrData}`;
      attemptLog += `Process for ${browserName} closed with code ${code}\n`;

      if (stderrData.toLowerCase().includes('xvfb') && stderrData.toLowerCase().includes('missing the dependency')) {
        resolve({
          status: 'error_xvfb',
          log: attemptLog,
          output: {
            status: 'error_running',
            message: `Cypress Run with ${browserName} Failed: Xvfb dependency reported.`,
            detailedLog: `Xvfb error detected with ${browserName}.\n${fullLog.substring(0, 1500)}`,
            specPath: specFilePath,
          }
        });
        return;
      }

      if (code === 0 && (stdoutData.includes('All specs passed!') || stdoutData.match(/\(\d+ passing\)/))) {
        resolve({
          status: 'ok',
          log: attemptLog,
          output: {
            status: 'completed_successfully',
            message: `Cypress headless run with ${browserName} for spec: ${relativeSpecPath} completed successfully.`,
            specPath: specFilePath,
            runSummary: stdoutData.substring(stdoutData.lastIndexOf('Run Summary'), stdoutData.lastIndexOf('Done running') !== -1 ? stdoutData.lastIndexOf('Done running') : undefined) || 'Tests passed.',
            detailedLog: fullLog.substring(0, 1500),
          }
        });
      } else { // Includes code !== 0, test failures, or other stderr output
        resolve({
          status: 'error_generic',
          log: attemptLog,
          output: {
            status: code !== 0 || stdoutData.match(/\(\d+ failing\)/) ? 'completed_with_failures' : 'error_running',
            message: `Cypress headless run with ${browserName} for spec: ${relativeSpecPath} ${code !==0 || stdoutData.match(/\(\d+ failing\)/) ? 'completed with failures/errors' : 'did not complete as expected'}. Exit code: ${code}.`,
            specPath: specFilePath,
            runSummary: stdoutData.substring(stdoutData.lastIndexOf('Run Summary'), stdoutData.lastIndexOf('Done running') !== -1 ? stdoutData.lastIndexOf('Done running') : undefined) || 'Run did not complete successfully or had failures.',
            detailedLog: fullLog.substring(0, 1500),
          }
        });
      }
    });
  });
}


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
  const commonSpawnOptions: { cwd: string; stdio: StdioOptions; env: Record<string, string | undefined> } = {
    cwd: repoPath,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DISPLAY: '' },
  };
  
  let cumulativeLog = "Starting Cypress headless execution attempts...\n";

  // Attempt 1: Chrome Headless
  cumulativeLog += "\n--- Attempting with Chrome headless ---\n";
  const chromeArgs = ['run', '--browser', 'chrome', '--headless', '--spec', relativeSpecPath];
  let attemptResult = await tryCypressRunAttempt(chromeArgs, commonSpawnOptions, specFilePath, relativeSpecPath, 'Chrome');
  cumulativeLog += attemptResult.log;

  if (attemptResult.status === 'ok' || (attemptResult.status === 'error_generic' && attemptResult.output.status !== 'error_running')) {
    return { ...attemptResult.output, detailedLog: (cumulativeLog + "\nFinal Result from Chrome attempt:\n" + (attemptResult.output.detailedLog || "")).substring(0,2500) };
  }
  

  cumulativeLog += "\n--- Chrome headless attempt encountered issues (likely Xvfb or startup). Attempting with Firefox headless ---\n";
  const firefoxArgs = ['run', '--browser', 'firefox', '--headless', '--spec', relativeSpecPath];
  attemptResult = await tryCypressRunAttempt(firefoxArgs, commonSpawnOptions, specFilePath, relativeSpecPath, 'Firefox');
  cumulativeLog += attemptResult.log;
  
  const finalMessage = attemptResult.status === 'ok' ? attemptResult.output.message : `${attemptResult.output.message} (after trying Chrome then Firefox).`;
  const finalDetailedLog = (cumulativeLog + "\nFinal Result from Firefox attempt:\n" + (attemptResult.output.detailedLog || "")).substring(0,2500);

  return { ...attemptResult.output, message: finalMessage, detailedLog: finalDetailedLog };
}

export const executeCypressRunHeadless = ai.defineFlow(
  {
    name: 'executeCypressRunHeadlessFlow', 
    inputSchema: ExecuteCypressRunHeadlessInputSchema,
    outputSchema: ExecuteCypressRunHeadlessOutputSchema,
  },
  executeCypressRunHeadlessLogic
);

