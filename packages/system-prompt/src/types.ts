export interface SystemPromptContext {
  environmentName: string;
  skills?: {
    enabled: boolean;
    readToolName: string;
  };
  telegram: {
    inboxDir: string;
    outputStyle: "chat";
  };
}
