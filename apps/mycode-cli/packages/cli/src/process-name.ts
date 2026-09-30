export const CLI_COMMAND_NAME = "mycode";
export const CLI_PROCESS_NAME = "mycode-cli";

interface ProcessTitleTarget {
  title: string;
}

export const setCliProcessTitle = (
  target: ProcessTitleTarget = process,
): void => {
  target.title = CLI_PROCESS_NAME;
};
