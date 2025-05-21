
'use server';
/**
 * @fileOverview Saves a Cypress test file and attempts to open Cypress in headed mode.
 *
 * - executeCypressOpen - Saves the test and runs `cypress open`.
 * - ExecuteCypressOpenInput - Input type for the flow.
 * - ExecuteCypressOpenOutput - Output type for the flow.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

const ExecuteCypressOpenInputSchema = z.object({
  testCode: z.string().describe('The Cypress test code to be saved and executed.'),
  repoPath: z.string().describe('The absolute local path to the cloned repository (Cypress project root).'),
  specFileName: z.string().describe('The desired file name for the spec, e.g., "user-login.cy.ts".'),
});
export type ExecuteCypressOpenInput = z.infer<typeof ExecuteCypressOpenInputSchema>;

const ExecuteCypressOpenOutputSchema = z.object({
  status: z.enum(['launched', 'error', 'already-running']).describe('Status of the Cypress open attempt.'),
  message: z.string().describe('A message detailing the outcome.'),
  specPath: z.string().optional().describe('The full path to the saved spec file.'),
});
export type ExecuteCypressOpenOutput = z.infer<typeof ExecuteCypressOpenOutputSchema>;

async function executeCypressOpenLogic(input: ExecuteCypressOpenInput): Promise<ExecuteCypressOpenOutput> {
  const { testCode, repoPath, specFileName } = input;

  if (!fs.existsSync(repoPath)) {
    return { status: 'error', message: `Repository path does not exist: ${repoPath}` };
  }

  const cypressE2eDir = path.join(repoPath, 'cypress', 'e2e');
  const specFilePath = path.join(cypressE2eDir, specFileName);

  try {
    // Ensure the cypress/e2e directory exists
    if (!fs.existsSync(cypressE2eDir)) {
      fs.mkdirSync(cypressE2eDir, { recursive: true });
    }

    // Save the test code to the spec file
    fs.writeFileSync(specFilePath, testCode, 'utf8');
  } catch (error: any) {
    return {
      status: 'error',
      message: `Failed to save test file at ${specFilePath}: ${error.message}`,
      specPath: specFilePath,
    };
  }

  // Path to the spec file relative to the Cypress project root
  const relativeSpecPath = path.join('cypress', 'e2e', specFileName);

  return new Promise((resolve) => {
    let stdoutData = '';
    let stderrData = '';
    const cypressProcess = spawn('npx', ['cypress', 'open', '--spec', relativeSpecPath], {
      cwd: repoPath,
      detached: true, // Allows parent to exit independently
      stdio: ['ignore', 'pipe', 'pipe'], // Ignore stdin, pipe stdout/stderr
    });

    // Unreference the child process so the parent can exit
    cypressProcess.unref();

    // Listen for stdout
    cypressProcess.stdout?.on('data', (data) => {
      stdoutData += data.toString();
      // A common message when Cypress is already running for the project.
      // This is a heuristic and might need adjustment based on actual Cypress output.
      if (stdoutData.includes('Cypress App port is already in use') || stdoutData.includes('Still waiting to connect to Cypress')) {
         // Check if it's the "already running" message which can take a few seconds.
         // We resolve quickly if it's clearly an "already running" type message.
         if (stdoutData.includes('Cypress App port is already in use') && !cypressProcess.killed) {
            try {
              process.kill(cypressProcess.pid!, 'SIGTERM'); // Try to kill it as we assume user will use existing one.
            } catch (e) {}
            resolve({
              status: 'already-running',
              message: `Cypress appears to be already running for project at ${repoPath}. Please switch to the existing Cypress window. Spec: ${relativeSpecPath}`,
              specPath: specFilePath,
            });
            return;
         }
      }
    });
    
    // Listen for stderr
    cypressProcess.stderr?.on('data', (data) => {
      stderrData += data.toString();
    });

    // Handle errors during spawning (e.g., command not found)
    cypressProcess.on('error', (err) => {
      resolve({
        status: 'error',
        message: `Failed to start Cypress: ${err.message}. Ensure Cypress is installed in the project or globally. Log: ${stderrData}`,
        specPath: specFilePath,
      });
    });

    // Handle process exit/close
    // This is tricky for `cypress open` as it's a long-running GUI process.
    // We resolve as 'launched' quickly, assuming it worked if no immediate 'error' event.
    // The 'exit' event might only fire when the user closes the Cypress GUI.
    cypressProcess.on('spawn', () => {
        // Heuristic: if it spawns and doesn't error out immediately, assume launch.
        // The stdout/stderr listeners might catch more specific states like "already running".
         setTimeout(() => { // Give a small delay for potential "already running" messages.
            if(cypressProcess.killed) return; // If already resolved (e.g. already-running)

            // Check if stdoutData after a short delay indicates it's still trying to connect (often means it launched)
            if (stdoutData.includes('Opening Cypress') || stdoutData.includes('Still waiting to connect') || stdoutData === '') {
                 resolve({
                    status: 'launched',
                    message: `Cypress launched for spec: ${relativeSpecPath}. Check the Cypress Test Runner window.`,
                    specPath: specFilePath,
                });
            } else if (stderrData) { // If there was some stderr output but no explicit error event.
                 resolve({
                    status: 'error',
                    message: `Cypress may have issues launching. Stderr: ${stderrData.substring(0, 500)}`,
                    specPath: specFilePath,
                });
            } else { // Fallback
                 resolve({
                    status: 'launched',
                    message: `Cypress launch initiated for spec: ${relativeSpecPath}. Stdout: ${stdoutData.substring(0, 200)}`,
                    specPath: specFilePath,
                });
            }

        }, 1500); // Wait 1.5 seconds to see if critical errors or "already running" messages appear
    });


    // This 'exit' handler might not be very useful for `cypress open` because
    // the parent process (this flow) will likely finish before the Cypress GUI is closed by the user.
    // cypressProcess.on('exit', (code) => {
    //   if (code === 0) {
    //     // This might be too late if we already resolved with 'launched'
    //   } else {
    //     // Handle non-zero exit code if we haven't resolved yet
    //   }
    // });
  });
}

export const executeCypressOpen = ai.defineFlow(
  {
    name: 'executeCypressOpenFlow',
    inputSchema: ExecuteCypressOpenInputSchema,
    outputSchema: ExecuteCypressOpenOutputSchema,
  },
  executeCypressOpenLogic
);
