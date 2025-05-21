
"use client";

import React, { useState, useEffect } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import type { TestType } from '@/lib/constants';
import { generateCypressTest, type GenerateCypressTestInput, type GenerateCypressTestOutput } from '@/ai/flows/generate-cypress-test';
import { identifyUserFlows, type IdentifyUserFlowsInput, type IdentifyUserFlowsOutput } from '@/ai/flows/identify-user-flows-flow';
import { executeCypressOpen, type ExecuteCypressOpenInput, type ExecuteCypressOpenOutput } from '@/ai/flows/execute-cypress-open-flow';
import { Github, Link as LinkIcon, ListTree, TestTubeDiagonal, Wand2, Play, Loader2, CheckCircle2, XCircle, AlertTriangle, ExternalLink } from 'lucide-react';

interface TestRunStatus {
  status: 'idle' | 'launching' | 'launched' | 'error' | 'already-running';
  message: string;
  specPath?: string;
  logs?: string; 
}

// Helper to sanitize flow names for filenames
const sanitizeFlowNameForFilename = (flowName: string): string => {
  return flowName.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/-+/g, '-') + '.cy.ts';
};


export default function CypressPilotPage() {
  const [appUrl, setAppUrl] = useState<string>('https://myapp.example.com');
  const [repoUrl, setRepoUrl] = useState<string>('https://github.com/myorg/myapp');
  
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisLog, setAnalysisLog] = useState<string | null>(null);
  const [clonedRepoPath, setClonedRepoPath] = useState<string | null>(null);
  const [userFlows, setUserFlows] = useState<string[]>([]);
  const [selectedFlow, setSelectedFlow] = useState<string | null>(null);
  const [selectedTestType, setSelectedTestType] = useState<TestType | null>(null);
  
  const [isGeneratingTest, setIsGeneratingTest] = useState<boolean>(false);
  const [generatedTestCode, setGeneratedTestCode] = useState<string | null>(null);
  
  const [isLaunchingTest, setIsLaunchingTest] = useState<boolean>(false);
  const [testRunStatus, setTestRunStatus] = useState<TestRunStatus>({ status: 'idle', message: '' });

  const { toast } = useToast();

  const handleAnalyzeRepo = async () => {
    if (!repoUrl) {
      toast({ title: "Missing Repository URL", description: "Please provide the GitHub Repository URL.", variant: "destructive" });
      return;
    }
    setIsAnalyzing(true);
    setUserFlows([]);
    setSelectedFlow(null);
    setGeneratedTestCode(null);
    setClonedRepoPath(null);
    setTestRunStatus({ status: 'idle', message: '' });
    setAnalysisLog("Starting repository analysis...\nThis may take a moment depending on repository size.\n");
    
    try {
      const input: IdentifyUserFlowsInput = {
        repoUrl,
        appUrl: appUrl || undefined,
      };
      const output: IdentifyUserFlowsOutput = await identifyUserFlows(input);
      
      setAnalysisLog(prev => prev + (output.analysisLog || "Analysis process completed.\n"));
      setClonedRepoPath(output.clonedRepoPath || null);

      if (output.clonedRepoPath) {
         setAnalysisLog(prev => prev + `Repository cloned to: ${output.clonedRepoPath}\n`);
      }

      if (output.identifiedFlows && output.identifiedFlows.length > 0) {
        setUserFlows(output.identifiedFlows);
        setSelectedFlow(output.identifiedFlows[0] || null);
        toast({ title: "Analysis Complete", description: "User flows identified. Please select a flow and test type." });
      } else {
        setUserFlows([]);
        toast({ title: "No Flows Identified", description: "The AI could not identify user flows. Check the analysis log.", variant: "default" });
      }
    } catch (error: any) {
      console.error("Error identifying user flows from repo:", error);
      setUserFlows([]);
      setClonedRepoPath(null);
      setAnalysisLog(prev => prev + `Error during analysis: ${error.message}\n${error.stack || ''}\n`);
      toast({ title: "Analysis Failed", description: `Could not identify user flows: ${error.message || 'Unknown error'}. Check console and analysis log.`, variant: "destructive" });
    }
    setIsAnalyzing(false);
  };

  const handleGenerateTest = async () => {
    if (!selectedFlow || !selectedTestType) {
      toast({ title: "Missing Selections", description: "Please select a user flow and a test type.", variant: "destructive" });
      return;
    }
    setIsGeneratingTest(true);
    setGeneratedTestCode(null);
    setTestRunStatus({ status: 'idle', message: '' });
    try {
      const input: GenerateCypressTestInput = {
        flowDescription: selectedFlow,
        testType: selectedTestType,
        applicationDetails: `App URL: ${appUrl || 'N/A'}, GitHub Repo: ${repoUrl}`, 
      };
      const output: GenerateCypressTestOutput = await generateCypressTest(input);
      setGeneratedTestCode(output.testCode);
      toast({ title: "Test Generated", description: "Cypress test code has been successfully generated." });
    } catch (error: any) {
      console.error("Error generating test:", error);
      toast({ title: "Generation Failed", description: `Could not generate the Cypress test: ${error.message || 'Unknown error'}. Please try again.`, variant: "destructive" });
    }
    setIsGeneratingTest(false);
  };

  const handleRunTest = async () => {
    if (!generatedTestCode) {
      toast({ title: "No Test Code", description: "Generate a test before running.", variant: "destructive" });
      return;
    }
    if (!clonedRepoPath) {
      toast({ title: "Repository Not Analyzed", description: "Please analyze a repository first. The test will run in the context of the cloned repository.", variant: "destructive" });
      return;
    }
    if (!selectedFlow) {
      toast({ title: "No Flow Selected", description: "A user flow must be selected to name the test file.", variant: "destructive" });
      return;
    }

    setIsLaunchingTest(true);
    const specFileName = sanitizeFlowNameForFilename(selectedFlow);
    setTestRunStatus({ status: 'launching', message: `Attempting to launch Cypress for ${specFileName}...`, logs: `Preparing to launch Cypress for ${specFileName} in ${clonedRepoPath}` });
    
    try {
      const input: ExecuteCypressOpenInput = {
        testCode: generatedTestCode,
        repoPath: clonedRepoPath,
        specFileName: specFileName,
      };
      const output: ExecuteCypressOpenOutput = await executeCypressOpen(input);
      
      setTestRunStatus({
        status: output.status,
        message: output.message,
        specPath: output.specPath,
        logs: output.detailedErrorLog || output.message, 
      });

      if (output.status === 'launched') {
        toast({ title: "Cypress Launched", description: `Check the Cypress Test Runner window for ${specFileName}.` });
      } else if (output.status === 'already-running') {
        toast({ title: "Cypress Already Running", description: output.message, variant: "default" });
      } else { // 'error' status
        toast({ title: "Cypress Launch Error", description: output.message, variant: "destructive" });
      }

    } catch (error: any) {
      console.error("Error launching Cypress:", error);
      setTestRunStatus({
        status: 'error',
        message: `Failed to launch Cypress: ${error.message || 'Unknown error'}`,
        logs: `Error: ${error.message || 'Unknown error'}.\n${error.stack || ''}. Check console for details.`,
      });
      toast({ title: "Launch Failed", description: `Could not launch Cypress: ${error.message || 'Unknown error'}.`, variant: "destructive" });
    }
    setIsLaunchingTest(false);
  };

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground font-sans">
      <AppHeader />
      <main className="flex-grow container mx-auto p-4 md:p-6 lg:p-8">
        <div className="grid lg:grid-cols-2 gap-6 md:gap-8">
          {/* Left Pane: Configuration & Generation */}
          <div className="space-y-6 md:space-y-8">
            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle className="text-2xl">1. Configure Application</CardTitle>
                <CardDescription>Provide your application and repository details. The repository will be cloned locally.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="appUrl" className="flex items-center"><LinkIcon className="mr-2 h-4 w-4 text-muted-foreground" />App URL (Optional, for context)</Label>
                  <Input id="appUrl" placeholder="https://myapp.example.com" value={appUrl} onChange={(e) => setAppUrl(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="repoUrl" className="flex items-center"><Github className="mr-2 h-4 w-4 text-muted-foreground" />GitHub Repo URL (Public)</Label>
                  <Input id="repoUrl" placeholder="https://github.com/myorg/myapp" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} />
                   <p className="text-xs text-muted-foreground">The application will clone this public repository to a temporary local directory.</p>
                </div>
              </CardContent>
              <CardFooter>
                <Button onClick={handleAnalyzeRepo} disabled={isAnalyzing || !repoUrl} className="w-full bg-primary hover:bg-primary/90 text-primary-foreground">
                  {isAnalyzing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ListTree className="mr-2 h-4 w-4" />}
                  {isAnalyzing ? 'Analyzing Repository...' : 'Analyze Repository & Identify Flows'}
                </Button>
              </CardFooter>
            </Card>
            
            {analysisLog && ( // Show analysis log if it's not null (even if analyzing is done)
              <Card className="shadow-md">
                <CardHeader>
                  <CardTitle className="text-lg">Analysis Log</CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-40 w-full rounded-md border bg-muted/30 p-3">
                    <pre className="text-xs font-mono whitespace-pre-wrap break-all">{analysisLog}</pre>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}

            {userFlows.length > 0 && (
              <Card className="shadow-lg">
                <CardHeader>
                  <CardTitle className="text-2xl">2. Generate Test</CardTitle>
                  <CardDescription>Select a user flow and test type to generate Cypress code.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="userFlow" className="flex items-center"><ListTree className="mr-2 h-4 w-4 text-muted-foreground" />Select User Flow</Label>
                    <Select value={selectedFlow || ""} onValueChange={setSelectedFlow}>
                      <SelectTrigger id="userFlow" className="w-full">
                        <SelectValue placeholder="Choose a user flow" />
                      </SelectTrigger>
                      <SelectContent>
                        {userFlows.map((flow, index) => (
                          <SelectItem key={`${flow}-${index}`} value={flow}>{flow}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-3">
                    <Label className="flex items-center"><TestTubeDiagonal className="mr-2 h-4 w-4 text-muted-foreground" />Select Test Type</Label>
                    <RadioGroup value={selectedTestType || ""} onValueChange={(value) => setSelectedTestType(value as TestType)} className="flex space-x-4">
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="E2E" id="r1" />
                        <Label htmlFor="r1" className="font-normal">End-to-End (E2E)</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="Component" id="r2" />
                        <Label htmlFor="r2" className="font-normal">Component</Label>
                      </div>
                    </RadioGroup>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button onClick={handleGenerateTest} disabled={isGeneratingTest || !selectedFlow || !selectedTestType} className="w-full bg-accent hover:bg-accent/90 text-accent-foreground">
                    {isGeneratingTest ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                    {isGeneratingTest ? 'Generating Code...' : 'Generate Cypress Test'}
                  </Button>
                </CardFooter>
              </Card>
            )}
            {isAnalyzing && userFlows.length === 0 && !analysisLog?.includes("cloned to:") && ( // Message during initial cloning/analysis phase
                 <div className="flex flex-col items-center justify-center h-40 border border-dashed rounded-md p-4">
                    <Loader2 className="h-10 w-10 animate-spin text-primary mb-3" />
                    <p className="text-muted-foreground text-center">Preparing to analyze repository...</p>
                </div>
            )}
          </div>

          {/* Right Pane: Test Code & Launch Control */}
          <div className="space-y-6 md:space-y-8">
            {(generatedTestCode || isGeneratingTest || isLaunchingTest || testRunStatus.status !== 'idle') && (
              <Card className="shadow-lg">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-2xl">3. Test Output & Execution</CardTitle>
                  {generatedTestCode && !isLaunchingTest && (
                    <Button onClick={handleRunTest} size="sm" variant="outline" disabled={!clonedRepoPath}>
                      <Play className="mr-2 h-4 w-4" /> Run Test with Cypress
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="space-y-4">
                  {isGeneratingTest && (
                     <div className="flex flex-col items-center justify-center h-60 border border-dashed rounded-md">
                        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
                        <p className="text-muted-foreground">Generating your Cypress test code...</p>
                    </div>
                  )}

                  {generatedTestCode && (
                    <div>
                      <h3 className="font-semibold mb-2 text-lg">Generated Test Code:</h3>
                      <ScrollArea className="h-72 w-full rounded-md border bg-muted/30 p-4">
                        <pre className="text-sm font-mono whitespace-pre-wrap break-all"><code>{generatedTestCode}</code></pre>
                      </ScrollArea>
                      {!clonedRepoPath && <p className="text-sm text-destructive mt-2">Note: Repository analysis with cloning must be successful to enable test execution.</p>}
                    </div>
                  )}
                  
                  {(isLaunchingTest || testRunStatus.status !== 'idle') && (
                     <div className="mt-6">
                      <h3 className="font-semibold mb-2 text-lg">Cypress Launch Status:</h3>
                      {testRunStatus.status === 'launching' && (
                         <div className="flex flex-col items-center justify-center h-40 border border-dashed rounded-md">
                            <Loader2 className="h-10 w-10 animate-spin text-accent mb-3" />
                            <p className="text-muted-foreground">Launching Cypress...</p>
                            {testRunStatus.logs && <p className="text-xs text-muted-foreground mt-2">{testRunStatus.logs}</p>}
                        </div>
                      )}
                      {testRunStatus.status !== 'launching' && testRunStatus.status !== 'idle' && (
                        <Alert 
                            variant={testRunStatus.status === 'error' ? 'destructive' : 'default'}
                            className={
                                testRunStatus.status === 'launched' ? 'bg-green-50 dark:bg-green-900/30 border-green-300 dark:border-green-700' 
                                : testRunStatus.status === 'already-running' ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700'
                                : testRunStatus.status === 'error' ? 'bg-red-50 dark:bg-red-900/30 border-red-300 dark:border-red-700'
                                : '' // Default styling if needed for other statuses
                            }
                        >
                          {testRunStatus.status === 'launched' && <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />}
                          {testRunStatus.status === 'already-running' && <ExternalLink className="h-5 w-5 text-blue-600 dark:text-blue-400" />}
                          {testRunStatus.status === 'error' && <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />}
                          
                          <AlertTitle className={`font-semibold ${
                            testRunStatus.status === 'launched' ? 'text-green-700 dark:text-green-300'
                            : testRunStatus.status === 'already-running' ? 'text-blue-700 dark:text-blue-300'
                            : testRunStatus.status === 'error' ? 'text-red-700 dark:text-red-300'
                            : ''
                          }`}>
                            {testRunStatus.status === 'launched' ? 'Cypress Launched' : 
                             testRunStatus.status === 'already-running' ? 'Cypress Likely Already Running' :
                             testRunStatus.status === 'error' ? 'Cypress Launch Error' :
                             'Cypress Status'}
                          </AlertTitle>
                          <AlertDescription className="mt-2 text-sm">
                            <p>{testRunStatus.message}</p>
                            {testRunStatus.specPath && <p className="mt-1">Spec file: <code className="font-mono text-xs bg-muted p-1 rounded">{testRunStatus.specPath}</code></p>}
                             {testRunStatus.logs && (testRunStatus.status === 'error' || testRunStatus.status === 'already-running' || testRunStatus.status === 'launched') && (
                                 <ScrollArea className="h-24 max-h-48 rounded-md bg-background/50 p-2 border mt-2">
                                    <pre className="text-xs font-mono whitespace-pre-wrap break-all">
                                    {testRunStatus.logs}
                                    </pre>
                                </ScrollArea>
                            )}
                          </AlertDescription>
                        </Alert>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
             { !isAnalyzing && !isGeneratingTest && !generatedTestCode && userFlows.length === 0 && repoUrl && !clonedRepoPath && (
                <Card className="shadow-lg">
                    <CardHeader>
                        <CardTitle className="text-xl">Next Steps</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">
                            Click "Analyze Repository & Identify Flows". If analysis fails or no flows are found, check the log. The repository will be cloned to a temporary local directory.
                        </p>
                    </CardContent>
                </Card>
            )}
             { !repoUrl && !isAnalyzing && !isGeneratingTest && (
                 <Card className="shadow-lg">
                    <CardHeader>
                        <CardTitle className="text-xl">Get Started</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">
                           Provide a public GitHub repository URL in section 1. The app will clone it, analyze its structure, and suggest user flows for test generation. Then, it can attempt to run the generated test using your local Cypress installation.
                        </p>
                    </CardContent>
                </Card>
             )}
          </div>
        </div>
      </main>
    </div>
  );
}
