// util/objectNaming.ts - Object case transformation utilities for API compatibility

/**
 * Convert an object's keys from camelCase to snake_case recursively
 */
export function objToSnakeCase(obj: any): any {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(objToSnakeCase);
  }

  const snakeCaseObj: any = {};
  
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const snakeKey = camelToSnakeCase(key);
      const value = obj[key];
      
      if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof Buffer)) {
        snakeCaseObj[snakeKey] = objToSnakeCase(value);
      } else if (Array.isArray(value)) {
        snakeCaseObj[snakeKey] = value.map(objToSnakeCase);
      } else {
        snakeCaseObj[snakeKey] = value;
      }
    }
  }
  
  return snakeCaseObj;
}

/**
 * Convert an object's keys from snake_case to camelCase recursively
 */
export function objToCamelCase(obj: any): any {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(objToCamelCase);
  }

  const camelCaseObj: any = {};
  
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const camelKey = snakeToCamelCase(key);
      const value = obj[key];
      
      if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof Buffer)) {
        camelCaseObj[camelKey] = objToCamelCase(value);
      } else if (Array.isArray(value)) {
        camelCaseObj[camelKey] = value.map(objToCamelCase);
      } else {
        camelCaseObj[camelKey] = value;
      }
    }
  }
  
  return camelCaseObj;
}

/**
 * Convert a single camelCase string to snake_case
 */
function camelToSnakeCase(str: string): string {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase();
}

/**
 * Convert a single snake_case string to camelCase
 */
function snakeToCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}