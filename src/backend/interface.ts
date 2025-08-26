// Local definition of Chunk to avoid circular dependency
interface Chunk {
  startLine: number;
  endLine: number;
  contents: string;
  filePath?: string;
}

// Note: These imports may not be available in CLI context
// import { ProjectAnalysis } from "./utils/projectAnalyzer.js";
// import { IndexesService } from "./services/indexes.js"; 
// import { IssuesService } from "./services/issues.js";
// import { ReposService } from "./services/repos.js";

// Placeholder types for CLI context
type ProjectAnalysis = any;
type IndexesService = any;
type IssuesService = any;
type ReposService = any;

export interface EmbeddingsCacheChunk {
  vector: number[];
  startLine: number;
  endLine: number;
  contents: string;
}

interface ArtifactReturnTypes {
  chunks: Chunk[];
  embeddings: EmbeddingsCacheChunk[];
}

export type ArtifactType = keyof ArtifactReturnTypes;

export interface EmbeddingsCacheResponse<T extends ArtifactType> {
  files: { [cacheKey: string]: ArtifactReturnTypes[T] };
}

export interface IDebuggAIServerClient {
  connected: boolean;
  url: URL | undefined;
  repos: ReposService | undefined;
  issues: IssuesService | undefined;
  indexes: IndexesService | undefined;
  getUserId(): Promise<string | undefined>;
  getUserToken(): string | undefined;
  getConfig(): Promise<{ configJson: string }>;
  getRepoName(filePath: string): Promise<string | undefined>;
  getRepoInfo(filePath: string): Promise<{ repoName: string | undefined; repoPath: string | undefined; branchName: string | undefined }>;
  getProjectLanguageConfig(): Promise<ProjectAnalysis>;
  getFromIndexCache<T extends ArtifactType>(
    keys: string[],
    artifactId: T,
    repoName: string | undefined,
  ): Promise<EmbeddingsCacheResponse<T>>;
}
