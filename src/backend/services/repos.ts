// services/repos.ts
import { AxiosTransport } from "../utils/axiosTransport";
import { systemLogger } from "../../util/system-logger";

export interface ReposService {
  upsertVectorCollection(
    collectionName: string,
    directory: string,
    branch: string,
    artifactId: string,
    repoName?: string,
  ): Promise<void>;
  deleteVectorCollection(collectionName: string): Promise<void>;
}

export const createReposService = (
  tx: AxiosTransport,
): ReposService => ({
  async upsertVectorCollection(collectionName, directory, branch, artifactId, repoName) {
    systemLogger.debug("upsertVectorCollection - ", collectionName, directory, branch, artifactId, repoName);
    try {
      const response = await tx.post("/api/v1/collections/upsert/", {
        collectionName,
        directory,
        branch,
        artifactId,
        repoName,
      });
      systemLogger.debug("upsertVectorCollection response - ", response);
    } catch (error) {
      systemLogger.error("Error upserting vector collection", error);
      throw error;
    }
  },

  async deleteVectorCollection(collectionName) {
    systemLogger.debug("deleteVectorCollection - ", collectionName);
    await tx.delete(`/api/v1/collections/${collectionName}/`);
  },
});
