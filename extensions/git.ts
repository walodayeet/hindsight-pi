import { execFile } from "node:child_process";

export interface GitExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export const execGit = async (cwd: string, args: string[]): Promise<GitExecResult | null> => {
  try {
    return await new Promise<GitExecResult>((resolve) => {
      execFile("git", args, { cwd, encoding: "utf8" }, (error, stdout, stderr) => {
        if (error) {
          const err = error as { code?: number };
          resolve({
            code: typeof err.code === "number" ? err.code : 1,
            stdout: stdout ?? "",
            stderr: stderr ?? "",
          });
          return;
        }
        resolve({ code: 0, stdout, stderr });
      });
    });
  } catch {
    return null;
  }
};
