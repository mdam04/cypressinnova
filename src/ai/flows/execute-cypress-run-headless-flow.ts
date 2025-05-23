
'use server';
/**
 * @fileOverview Saves a Cypress test file and attempts to run Cypress headlessly,
 * trying Chrome first, then Firefox if Chrome encounters Xvfb issues, and disabling video recording.
 * Also adds Electron-specific environment variables to promote headless behavior.
 *
 * - executeCypressRunHeadless - Saves the test and runs `cypress run --headless --browser <browser> --spec <spec> --config video=false`.
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
  baseCypressArgs: string[], // Base args like run
  browserName: string,
  spawnOptions: { cwd: string; stdio: StdioOptions; env: Record<string, string | undefined> },
  specFilePath: string,
  relativeSpecPath: string
): Promise<{ status: 'ok' | 'error_xvfb' | 'error_libglib' | 'error_generic'; output: ExecuteCypressRunHeadlessOutput; log: string }> {
  return new Promise((resolve) => {
    let stdoutData = '';
    let stderrData = '';
    // Add --config video=false to the arguments for the specified browser and headless mode
    const cypressArgs = [...baseCypressArgs, '--browser', browserName, '--headless', '--config', 'video=false', '--spec', relativeSpecPath];
    let attemptLog = `Attempting with ${browserName}: npx cypress ${cypressArgs.join(' ')}\n`;
    attemptLog += `Spawn options env: ${JSON.stringify(spawnOptions.env)}\n`;


    const cypressProcess = spawn('npx', ['cypress', ...cypressArgs], spawnOptions);

    cypressProcess.stdout?.on('data', (data) => {
      const line = data.toString();
      stdoutData += line;
      attemptLog += `STDOUT: ${line}\n`;
    });

    cypressProcess.stderr?.on('data', (data) => {
      const line = data.toString();
      stderrData += line;
      attemptLog += `STDERR: ${line}\n`;
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
      const fullLog = `Browser: ${browserName}\nCommand: npx cypress ${cypressArgs.join(' ')}\nExit Code: ${code}\n\nStdout:\n${stdoutData}\n\nStderr:\n${stderrData}`;
      attemptLog += `Process for ${browserName} closed with code ${code}\n`;

      if (stderrData.includes('libglib-2.0.so.0: cannot open shared object file')) {
        resolve({
          status: 'error_libglib',
          log: attemptLog,
          output: {
            status: 'error_running',
            message: `Cypress Run with ${browserName} Failed: Missing system library 'libglib-2.0.so.0'. This library is required by Cypress/Electron. Please install it in your environment (e.g., via 'apt-get install libglib2.0-0' on Debian/Ubuntu, or its equivalent for your OS).`,
            detailedLog: `Missing 'libglib-2.0.so.0' error detected with ${browserName}.\n${fullLog}`,
            specPath: specFilePath,
          }
        });
        return;
      }
      
      if (stderrData.toLowerCase().includes('xvfb') && (stderrData.toLowerCase().includes('missing the dependency') || stderrData.toLowerCase().includes('spawn xvfb enoent'))) {
        resolve({
          status: 'error_xvfb',
          log: attemptLog,
          output: {
            status: 'error_running',
            message: `Cypress Run with ${browserName} Failed: Xvfb dependency reported. This is needed for graphical components. Please install Xvfb in your environment.`,
            detailedLog: `Xvfb error detected with ${browserName}.\n${fullLog}`,
            specPath: specFilePath,
          }
        });
        return;
      }

      if (code === 0 && (stdoutData.includes('All specs passed!') || stdoutData.match(/\(\d+ passing\)/) || stdoutData.includes('No specs found'))) {
        // Consider "No specs found" as a successful Cypress run completion if exit code is 0
         let runSummaryText = 'Tests passed or no tests found.';
        if (stdoutData.includes('All specs passed!') || stdoutData.match(/\(\d+ passing\)/)) {
            runSummaryText = stdoutData.substring(stdoutData.lastIndexOf('Run Summary'), stdoutData.lastIndexOf('Done running') !== -1 ? stdoutData.lastIndexOf('Done running') : undefined) || 'Tests passed.';
        } else if (stdoutData.includes('No specs found')) {
            runSummaryText = 'Cypress run completed: No specs found matching the pattern.';
        }
        resolve({
          status: 'ok',
          log: attemptLog,
          output: {
            status: 'completed_successfully',
            message: `Cypress headless run with ${browserName} for spec: ${relativeSpecPath} completed successfully.`,
            specPath: specFilePath,
            runSummary: runSummaryText,
            detailedLog: fullLog,
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
            detailedLog: fullLog,
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
    env: {
      ...process.env,
      DISPLAY: '', // Keep this
      ELECTRON_RUN_AS_NODE: '1',
      ELECTRON_EXTRA_LAUNCH_ARGS: '--headless --disable-gpu --no-sandbox',
      CYPRESS_REMOTE_DEBUGGING_PORT: '0',
    },
  };

  let cumulativeLog = "Starting Cypress headless execution attempts...\n";
  const baseArgs = ['run'];

  // Attempt 1: Chrome Headless with video disabled and extra Electron flags
  cumulativeLog += `\n--- Attempting with Chrome headless (video disabled, Electron flags) ---\n`;
  let attemptResult = await tryCypressRunAttempt(baseArgs, 'chrome', commonSpawnOptions, specFilePath, relativeSpecPath);
  cumulativeLog += attemptResult.log;

  if (attemptResult.status === 'ok' || (attemptResult.status === 'error_generic' && attemptResult.output.status !== 'error_running')) {
    // If successful, or failed generically (but not a startup/xvfb/libglib issue for chrome itself), return this result
    return { ...attemptResult.output, detailedLog: (cumulativeLog + "\nFinal Result from Chrome attempt:\n" + (attemptResult.output.detailedLog || "")) };
  }
  // If Chrome attempt had an Xvfb or libglib error, or a generic startup error, proceed to Firefox

  cumulativeLog += `\n--- Chrome headless (video disabled, Electron flags) attempt encountered issues (${attemptResult.status}). Attempting with Firefox headless (video disabled, Electron flags) ---\n`;
  attemptResult = await tryCypressRunAttempt(baseArgs, 'firefox', commonSpawnOptions, specFilePath, relativeSpecPath);
  cumulativeLog += attemptResult.log;

  const finalMessage = attemptResult.status === 'ok' ? attemptResult.output.message : `${attemptResult.output.message} (after trying Chrome then Firefox, both with video disabled and Electron flags).`;
  const finalDetailedLog = (cumulativeLog + "\nFinal Result from Firefox attempt:\n" + (attemptResult.output.detailedLog || ""));

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

