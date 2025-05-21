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
import { MOCK_USER_FLOWS, type TestType } from '@/lib/constants';
import { generateCypressTest, type GenerateCypressTestInput, type GenerateCypressTestOutput } from '@/ai/flows/generate-cypress-test';
import { Github, Link as LinkIcon, ListTree, TestTubeDiagonal, Wand2, Play, Loader2, CheckCircle2, XCircle, AlertTriangle, TestTube2Icon } from 'lucide-react';

interface TestResult {
  status: 'success' | 'failure' | 'pending';
  logs: string;
  suggestions?: string;
  testCode?: string;
}

export default function CypressPilotPage() {
  const [appUrl, setAppUrl] = useState<string>('https://myapp.example.com');
  const [repoUrl, setRepoUrl] = useState<string>('https://github.com/myorg/myapp');
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [userFlows, setUserFlows] = useState<string[]>([]);
  const [selectedFlow, setSelectedFlow] = useState<string | null>(null);
  const [selectedTestType, setSelectedTestType] = useState<TestType | null>(null);
  
  const [isGeneratingTest, setIsGeneratingTest] = useState<boolean>(false);
  const [generatedTestCode, setGeneratedTestCode] = useState<string | null>(null);
  
  const [isRunningTest, setIsRunningTest] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const { toast } = useToast();

  const handleAnalyzeRepo = async () => {
    if (!appUrl || !repoUrl) {
      toast({ title: "Missing Information", description: "Please provide both App URL and GitHub Repo URL.", variant: "destructive" });
      return;
    }
    setIsAnalyzing(true);
    setTestResult(null);
    setGeneratedTestCode(null);
    setSelectedFlow(null);
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1500));
    setUserFlows(MOCK_USER_FLOWS);
    setSelectedFlow(MOCK_USER_FLOWS[0] || null);
    setIsAnalyzing(false);
    toast({ title: "Analysis Complete", description: "User flows identified. Please select a flow and test type." });
  };

  const handleGenerateTest = async () => {
    if (!selectedFlow || !selectedTestType) {
      toast({ title: "Missing Selections", description: "Please select a user flow and a test type.", variant: "destructive" });
      return;
    }
    setIsGeneratingTest(true);
    setGeneratedTestCode(null);
    setTestResult(null);
    try {
      const input: GenerateCypressTestInput = {
        flowDescription: selectedFlow,
        testType: selectedTestType,
        applicationDetails: `App URL: ${appUrl}, GitHub Repo: ${repoUrl}`,
      };
      const output: GenerateCypressTestOutput = await generateCypressTest(input);
      setGeneratedTestCode(output.testCode);
      toast({ title: "Test Generated", description: "Cypress test code has been successfully generated." });
    } catch (error) {
      console.error("Error generating test:", error);
      toast({ title: "Generation Failed", description: "Could not generate the Cypress test. Please try again.", variant: "destructive" });
    }
    setIsGeneratingTest(false);
  };

  const handleRunTest = async () => {
    if (!generatedTestCode) {
      toast({ title: "No Test Code", description: "Generate a test before running.", variant: "destructive" });
      return;
    }
    setIsRunningTest(true);
    setTestResult({ status: 'pending', logs: 'Starting test execution...\nInitializing Cypress environment...', testCode: generatedTestCode });
    
    // Simulate test execution
    await new Promise(resolve => setTimeout(resolve, 2500));
    
    const isSuccess = Math.random() > 0.4; // Simulate success/failure
    if (isSuccess) {
      setTestResult({
        status: 'success',
        logs: `Test execution started for: ${selectedFlow}\n[INFO] Navigating to ${appUrl}...\n[PASS] Page loaded successfully.\n[INFO] Performing actions for ${selectedFlow}...\n[PASS] All steps completed and assertions passed.\n\n✨ Test run finished successfully! ✨`,
        testCode: generatedTestCode,
      });
      toast({ title: "Test Passed!", description: "The generated Cypress test ran successfully." });
    } else {
      setTestResult({
        status: 'failure',
        logs: `Test execution started for: ${selectedFlow}\n[INFO] Navigating to ${appUrl}...\n[FAIL] Error: Timed out retrying: Expected to find element: \`#login-button\`, but never found it.\n[INFO] Attempting to find element: \`#username-input\`\n[PASS] Element \`#username-input\` found.\n\n❌ Test run failed. ❌`,
        suggestions: "The test failed likely due to a missing or incorrect selector for `#login-button`. \n1. Verify the selector is correct in your application's current version. \n2. Ensure the element is visible and interactable when the test attempts to find it. \n3. Check for typos in the selector in the generated test code.",
        testCode: generatedTestCode,
      });
      toast({ title: "Test Failed", description: "The Cypress test encountered errors.", variant: "destructive" });
    }
    setIsRunningTest(false);
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
                <CardDescription>Provide your application details to begin.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="appUrl" className="flex items-center"><LinkIcon className="mr-2 h-4 w-4 text-muted-foreground" />App URL</Label>
                  <Input id="appUrl" placeholder="https://myapp.example.com" value={appUrl} onChange={(e) => setAppUrl(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="repoUrl" className="flex items-center"><Github className="mr-2 h-4 w-4 text-muted-foreground" />GitHub Repo URL</Label>
                  <Input id="repoUrl" placeholder="https://github.com/myorg/myapp" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} />
                </div>
              </CardContent>
              <CardFooter>
                <Button onClick={handleAnalyzeRepo} disabled={isAnalyzing} className="w-full bg-primary hover:bg-primary/90 text-primary-foreground">
                  {isAnalyzing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ListTree className="mr-2 h-4 w-4" />}
                  {isAnalyzing ? 'Analyzing Repository...' : 'Analyze & Identify Flows'}
                </Button>
              </CardFooter>
            </Card>

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
                        {userFlows.map((flow) => (
                          <SelectItem key={flow} value={flow}>{flow}</SelectItem>
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
          </div>

          {/* Right Pane: Test Code & Results */}
          <div className="space-y-6 md:space-y-8">
            {(generatedTestCode || isGeneratingTest || isRunningTest || testResult) && (
              <Card className="shadow-lg">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-2xl">3. Test Output</CardTitle>
                  {generatedTestCode && !isRunningTest && testResult?.status !== 'pending' &&(
                    <Button onClick={handleRunTest} size="sm" variant="outline">
                      <Play className="mr-2 h-4 w-4" /> Run Test
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
                    </div>
                  )}
                  
                  {(isRunningTest || testResult) && (
                     <div className="mt-6">
                      <h3 className="font-semibold mb-2 text-lg">Test Execution:</h3>
                      {testResult?.status === 'pending' && (
                         <div className="flex flex-col items-center justify-center h-40 border border-dashed rounded-md">
                            <Loader2 className="h-10 w-10 animate-spin text-accent mb-3" />
                            <p className="text-muted-foreground">Running test...</p>
                        </div>
                      )}
                      {testResult && testResult.status !== 'pending' && (
                        <Alert variant={testResult.status === 'success' ? 'default' : 'destructive'} className={testResult.status === 'success' ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'}>
                          {testResult.status === 'success' ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <XCircle className="h-5 w-5 text-red-600" />}
                          <AlertTitle className={`font-semibold ${testResult.status === 'success' ? 'text-green-700' : 'text-red-700'}`}>
                            Test {testResult.status === 'success' ? 'Passed' : 'Failed'}
                          </AlertTitle>
                          <AlertDescription className="mt-2">
                            <p className="font-semibold mb-1 text-sm">Logs:</p>
                            <ScrollArea className="h-32 max-h-40 rounded-md bg-background/50 p-2 border">
                                <pre className="text-xs font-mono whitespace-pre-wrap break-all">
                                {testResult.logs}
                                </pre>
                            </ScrollArea>
                            {testResult.suggestions && (
                              <div className="mt-3 p-3 rounded-md bg-yellow-50 border border-yellow-300">
                                <div className="flex items-start">
                                  <AlertTriangle className="h-5 w-5 text-yellow-600 mr-2 shrink-0 mt-0.5" />
                                  <div>
                                    <p className="font-semibold text-yellow-700 text-sm">Suggestions for Fixing:</p>
                                    <pre className="text-xs font-mono whitespace-pre-wrap break-all text-yellow-800 mt-1">
                                        {testResult.suggestions}
                                    </pre>
                                  </div>
                                </div>
                              </div>
                            )}
                          </AlertDescription>
                        </Alert>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
