
'use server';
/**
 * @fileOverview Identifies potential user flows from a textual description of an application's structure or code.
 *
 * - identifyUserFlows - A function that identifies user flows.
 * - IdentifyUserFlowsInput - The input type for the identifyUserFlows function.
 * - IdentifyUserFlowsOutput - The return type for the identifyUserFlows function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const IdentifyUserFlowsInputSchema = z.object({
  applicationDescription: z.string().describe('A textual description of the application, including key files, main components, routes, or code snippets relevant to user interaction.'),
  appUrl: z.string().describe('The URL of the application, for context.'),
});
export type IdentifyUserFlowsInput = z.infer<typeof IdentifyUserFlowsInputSchema>;

const IdentifyUserFlowsOutputSchema = z.object({
  identifiedFlows: z.array(z.string()).describe('A list of identified potential user flows based on the provided description.'),
});
export type IdentifyUserFlowsOutput = z.infer<typeof IdentifyUserFlowsOutputSchema>;

export async function identifyUserFlows(input: IdentifyUserFlowsInput): Promise<IdentifyUserFlowsOutput> {
  return identifyUserFlowsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'identifyUserFlowsPrompt',
  input: {schema: IdentifyUserFlowsInputSchema},
  output: {schema: IdentifyUserFlowsOutputSchema},
  prompt: `You are an expert software analyst. Based on the provided application description (which might include file structures, route definitions, component names, or code snippets), and the application URL, identify and list potential user flows.
  Focus on sequences of actions a user might take.

  Application URL (for context): {{{appUrl}}}
  Application Description:
  {{{applicationDescription}}}

  List the identified user flows. For example: "User Login", "Create New Product", "View Dashboard", "Update Profile Settings".
  Return *only* the list of flows.
  `,
});

const identifyUserFlowsFlow = ai.defineFlow(
  {
    name: 'identifyUserFlowsFlow',
    inputSchema: IdentifyUserFlowsInputSchema,
    outputSchema: IdentifyUserFlowsOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    if (!output) {
      return { identifiedFlows: [] };
    }
    // Ensure the output is always an array, even if the LLM returns a single string by mistake.
    if (output.identifiedFlows && !Array.isArray(output.identifiedFlows)) {
        // Attempt to handle cases where LLM might return a string list or single item
        if (typeof output.identifiedFlows === 'string') {
            // Heuristic: split by common delimiters if it looks like a list
            if ((output.identifiedFlows as string).includes(',') || (output.identifiedFlows as string).includes('\n')) {
                 return { identifiedFlows: (output.identifiedFlows as string).split(/,|\n/).map(s => s.trim()).filter(s => s.length > 0) };
            }
            return { identifiedFlows: [output.identifiedFlows as string] };
        }
        // If it's some other non-array type, default to empty or try to coerce if appropriate
        console.warn("LLM returned non-array for identifiedFlows, attempting to adapt or defaulting to empty.");
        return { identifiedFlows: [] };
    }
    return output;
  }
);
