// Axios mock utilities for testing API client
import { AxiosResponse, AxiosRequestConfig } from 'axios';

export const createMockAxiosResponse = <T = any>(data: T, status: number = 200): AxiosResponse<T> => ({
  data,
  status,
  statusText: 'OK',
  headers: {},
  config: {} as any
});

export const createMockAxiosError = (status: number, message: string, response?: any) => {
  const error: any = new Error(message);
  error.response = {
    status,
    statusText: message,
    data: response
  };
  return error;
};

export const mockAxiosInstance = {
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  delete: jest.fn(),
  create: jest.fn(),
  interceptors: {
    request: {
      use: jest.fn()
    },
    response: {
      use: jest.fn()
    }
  }
};

export const mockAxios = {
  create: jest.fn(() => mockAxiosInstance),
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  delete: jest.fn(),
  interceptors: {
    request: {
      use: jest.fn()
    },
    response: {
      use: jest.fn()
    }
  }
};