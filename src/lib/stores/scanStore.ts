import { writable, get } from 'svelte/store';

export type ScanState = {
    isScanning: boolean;
    progress: number;
    status: string;
    currentLog: string;
    logs: string[];
    scannedCount: number;
    totalCount: number;
    error: string | null;
    targetUsername: string;
};

const initialState: ScanState = {
    isScanning: false,
    progress: 0,
    status: 'Idle',
    currentLog: '',
    logs: [],
    scannedCount: 0,
    totalCount: 0,
    error: null,
    targetUsername: ''
};

function createScanStore() {
    const { subscribe, set, update } = writable<ScanState>(initialState);

    return {
        subscribe,
        reset: () => set(initialState),

        startScan: async (userId: string, username: string) => {
            update(state => ({
                ...state,
                isScanning: true,
                progress: 0,
                status: 'Initializing scan...',
                targetUsername: username,
                error: null,
                logs: []
            }));

            try {
                const res = await fetch(`/api/user/${userId}?username=${encodeURIComponent(username)}`);
                if (!res.body) throw new Error("No response body");

                const reader = res.body.getReader();
                const decoder = new TextDecoder();

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split('\n');

                    for (const line of lines) {
                        if (!line.trim()) continue;
                        try {
                            const data = JSON.parse(line);

                            update(state => {
                                const newState = { ...state };

                                if (data.type === 'progress') {
                                    newState.progress = data.percentage;
                                    newState.scannedCount = data.current;
                                    newState.totalCount = data.total;
                                    newState.status = `Scanning: ${data.current} / ${data.total}`;
                                } else if (data.type === 'log') {
                                    newState.currentLog = data.message;
                                    newState.logs = [...state.logs, data.message];
                                } else if (data.type === 'done') {
                                    newState.status = "Scan Complete!";
                                    newState.isScanning = false;
                                    newState.progress = 100;
                                } else if (data.error) {
                                    newState.error = data.error;
                                    newState.status = "Error: " + data.error;
                                    newState.isScanning = false;
                                }
                                return newState;
                            });

                        } catch (e) {
                            console.error("Error parsing stream chunk", e);
                        }
                    }
                }
            } catch (e: any) {
                console.error("Fetch error:", e);
                update(state => ({
                    ...state,
                    isScanning: false,
                    error: e.message || "Failed to start scan",
                    status: "Failed"
                }));
            }
        }
    };
}

export const scanStore = createScanStore();
