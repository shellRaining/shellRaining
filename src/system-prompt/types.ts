export interface SystemPromptContext {
  environmentName: string;
  telegram: {
    inboxDir: string;
    outputStyle: "chat";
  };
}
