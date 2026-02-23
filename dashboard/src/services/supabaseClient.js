import fetch from 'node-fetch';
import { authService } from './authService.js';

// Single responsibility: Interface with Supabase RPC
const SUPABASE_URL = process.env.SUPABASE_URL || "https://vtllpagtmncbkywsqccd.supabase.co/rest/v1/rpc/rewards_get_allocations";
const API_KEY = process.env.SUPABASE_API_KEY || "sb_publishable_yKqi0fu5vV6G4ryUIMJuzw_NCoFEl1c";

export const supabaseClient = {
    async getAllocations() {
        const token = authService.getToken();
        if (!token) {
            throw new Error('Unauthorized: No bearer token set');
        }

        const headers = {
            "apikey": API_KEY,
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
        };

        const body = JSON.stringify({
            "skip": null,
            "take": null
        });

        try {
            const response = await fetch(SUPABASE_URL, {
                method: 'POST',
                headers: headers,
                body: body
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Supabase Error ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            return data;
        } catch (error) {
            console.error("Supabase Fetch Error:", error);
            throw error;
        }
    }
};
