import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import { URL } from "url";
import { systemLogger } from './system-logger';

/**
 * Download file with redirect handling - adapted from working IDE recordingHandler.ts
 * This handles the complex redirect logic that the backend artifact URLs require
 */
async function downloadFileWithRedirects(
  url: string, 
  filePath: string, 
  maxRedirects: number = 5, 
  originalBaseUrl?: string
): Promise<void> {
  let currentUrl = url;
  let redirectCount = 0;

  while (redirectCount <= maxRedirects) {
    systemLogger.debug(`Attempting to download from: ${currentUrl} (redirect ${redirectCount})`, { category: 'artifact' });
    
    const fileUrl = new URL(currentUrl);
    const file = fs.createWriteStream(filePath);

    try {
      const redirectUrl = await new Promise<string | null>((resolve, reject) => {
        const request = fileUrl.protocol === 'https:' ? https.get : http.get;
        
        request(currentUrl, (response) => {
          const statusCode = response.statusCode || 0;
          
          // Handle redirects
          if (statusCode >= 300 && statusCode < 400) {
            const location = response.headers.location;
            if (!location) {
              reject(new Error(`Redirect response (${statusCode}) without Location header`));
              return;
            }
            
            // Close the current file stream since we're redirecting
            file.close();
            resolve(location);
            return;
          }
          
          // Handle success
          if (statusCode === 200) {
            response.pipe(file);
            file.on("finish", () => {
              systemLogger.debug(`File download finished. Replacing URLs with ${originalBaseUrl}`, { category: 'artifact' });
              
              // Close the file stream first and wait for it to complete
              file.close((err) => {
                if (err) {
                  systemLogger.error(`Failed to close file stream for ${filePath}: ${err}`, { category: 'artifact' });
                  reject(err);
                  return;
                }
                
                try {
                  if (originalBaseUrl) {
                    // Replace any https://<any digit, letter, hyphen>.ngrok.debugg.ai urls with localhost:localPort
                    const fileContent = fs.readFileSync(filePath, 'utf8');
                    const ngrokRegex = /https:\/\/[\w-]+\.ngrok\.debugg\.ai/g;
                    const updatedContent = fileContent.replace(ngrokRegex, originalBaseUrl);
                    fs.writeFileSync(filePath, updatedContent);
                    systemLogger.debug(`URL replacement completed for ${filePath}`, { category: 'artifact' });
                  }
                  
                  // Verify the file was actually written and has content
                  if (fs.existsSync(filePath)) {
                    const stats = fs.statSync(filePath);
                    if (stats.size > 0) {
                      systemLogger.debug(`File successfully saved: ${filePath} (${stats.size} bytes)`, { category: 'artifact' });
                      resolve(null); // null means success, no redirect
                    } else {
                      systemLogger.error(`File exists but is empty: ${filePath}`, { category: 'artifact' });
                      reject(new Error(`Downloaded file is empty: ${filePath}`));
                    }
                  } else {
                    systemLogger.error(`File was not created: ${filePath}`, { category: 'artifact' });
                    reject(new Error(`File was not created: ${filePath}`));
                  }
                } catch (error) {
                  systemLogger.error(`Error processing downloaded file ${filePath}: ${error}`, { category: 'artifact' });
                  reject(error);
                }
              });
            });
            
            file.on("error", (err) => {
              systemLogger.error(`File stream error for ${filePath}: ${err}`, { category: 'artifact' });
              file.close();
              if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
              }
              reject(err);
            });
            
            return;
          }
          
          // Handle other errors
          file.close();
          reject(new Error(`Failed to download file: ${statusCode}`));
        }).on("error", (err) => {
          systemLogger.error(`HTTP request error for ${currentUrl}: ${err}`, { category: 'artifact' });
          file.close();
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
          reject(err);
        });
      });

      // If no redirect, we're done
      if (!redirectUrl) {
        return;
      }

      // Handle redirect
      redirectCount++;
      if (redirectCount > maxRedirects) {
        throw new Error(`Too many redirects (${maxRedirects})`);
      }
      
      // Convert relative URLs to absolute
      if (redirectUrl.startsWith('/')) {
        const baseUrl = new URL(currentUrl);
        currentUrl = `${baseUrl.protocol}//${baseUrl.host}${redirectUrl}`;
      } else if (redirectUrl.startsWith('http')) {
        currentUrl = redirectUrl;
      } else {
        // Relative URL, resolve against current URL
        currentUrl = new URL(redirectUrl, currentUrl).toString();
      }
      
      systemLogger.debug(`Redirecting to: ${currentUrl}`, { category: 'artifact' });

    } catch (error) {
      // Clean up file on error
      systemLogger.error(`Exception during download process for ${currentUrl}: ${error}`, { category: 'artifact' });
      try {
        file.close();
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          systemLogger.debug(`Cleaned up failed download file: ${filePath}`, { category: 'artifact' });
        }
      } catch (cleanupError) {
        systemLogger.warn(`Failed to cleanup file after download error: ${cleanupError}`, { category: 'artifact' });
      }
      throw error;
    }
  }

  throw new Error(`Exceeded maximum redirects (${maxRedirects})`);
}

/**
 * Download artifact to buffer - adapted for CLI usage
 * This replaces the simple axios download with the proven redirect handling logic
 */
export async function downloadArtifactToBuffer(url: string, originalBaseUrl?: string): Promise<Buffer | null> {
  try {
    // Create a temporary file path
    const tempDir = require('os').tmpdir();
    const tempFile = require('path').join(tempDir, `debugg-ai-artifact-${Date.now()}.tmp`);
    
    systemLogger.debug(`Downloading artifact to temp file: ${tempFile}`, { category: 'artifact' });
    
    // Use the proven download logic
    await downloadFileWithRedirects(url, tempFile, 5, originalBaseUrl);
    
    // Read the file into a buffer
    const buffer = fs.readFileSync(tempFile);
    
    // Clean up temp file
    fs.unlinkSync(tempFile);
    
    systemLogger.debug(`Successfully downloaded artifact: ${buffer.length} bytes`, { category: 'artifact' });
    return buffer;
    
  } catch (error) {
    systemLogger.error(`Failed to download artifact from ${url}: ${error}`, { category: 'artifact' });
    return null;
  }
}

/**
 * Download artifact directly to a file path - for CLI usage
 */
export async function downloadArtifactToFile(
  url: string, 
  filePath: string, 
  originalBaseUrl?: string
): Promise<boolean> {
  try {
    systemLogger.debug(`Downloading artifact to: ${filePath}`, { category: 'artifact' });
    
    // Use the proven download logic
    await downloadFileWithRedirects(url, filePath, 5, originalBaseUrl);
    
    systemLogger.debug(`Successfully saved artifact to: ${filePath}`, { category: 'artifact' });
    return true;
    
  } catch (error) {
    systemLogger.error(`Failed to download artifact from ${url}: ${error}`, { category: 'artifact' });
    return false;
  }
}