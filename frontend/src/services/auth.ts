import { api } from './api';

export const authService = {
  register: (data: { business_name: string; name: string; email: string; password: string }) =>
    api.post<{ token: string }>('/auth/register', data),

  login: (data: { email: string; password: string }) =>
    api.post<{ token: string }>('/auth/login', data),
};
