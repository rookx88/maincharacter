import axios from 'axios';

// Create an axios instance with the correct base URL
const api = axios.create({
    baseURL: '/api', // This will use the current host/port
    withCredentials: true,
    timeout: 15000
});

// Add request interceptor for debugging
api.interceptors.request.use(
    config => {
        console.log(`API Request: ${config.method?.toUpperCase()} ${config.url}`, config.data);
        return config;
    },
    error => {
        console.error('API Request Error:', error);
        return Promise.reject(error);
    }
);

// Add response interceptor for debugging
api.interceptors.response.use(
    response => {
        console.log(`API Response: ${response.status} ${response.config.url}`, response.data);
        return response;
    },
    error => {
        console.error('API Response Error:', error.response || error);
        return Promise.reject(error);
    }
);

export default api; 