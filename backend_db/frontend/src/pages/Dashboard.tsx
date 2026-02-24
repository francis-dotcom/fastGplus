import { useEffect, useState, useRef } from 'react';
import { getUserCountUsersCountGet, getTableCountTablesCountGet, getStorageStatsStorageFilesStatsGet, listFunctionsFunctionsGet, listWebhooksWebhooksGet } from '../client/sdk.gen';
import { API_KEY } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Users, Database, ArrowRight, FolderOpen, Code, Webhook } from 'lucide-react';
import { Link } from 'react-router-dom';

// Format bytes to human readable (decimal/SI units like macOS)
function formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1000; // Decimal (SI) - matches macOS, iOS, storage manufacturers
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export default function Dashboard() {
    const { token, realtime } = useAuth();
    const [userCount, setUserCount] = useState(0);
    const [tableCount, setTableCount] = useState(0);
    const [bucketCount, setBucketCount] = useState(0);
    const [totalStorageSize, setTotalStorageSize] = useState(0);
    const [functionCount, setFunctionCount] = useState(0);
    const [webhookCount, setWebhookCount] = useState(0);


    // Track if we've fetched initial data to prevent counting before initial load
    const initialFetchDone = useRef(false);

    // Helper to fetch actual counts from DB - used to sync counts on realtime events
    const fetchActualCounts = async (context: string) => {
        if (!token) return { actualUsers: null, actualTables: null, actualBuckets: null, actualStorageSize: null, actualFunctions: null, actualWebhooks: null };
        try {
            const [usersRes, tablesRes, storageRes, functionsRes, webhooksRes] = await Promise.all([
                getUserCountUsersCountGet({
                    headers: { 'X-API-Key': API_KEY, Authorization: `Bearer ${token}` }
                }),
                getTableCountTablesCountGet({
                    headers: { 'X-API-Key': API_KEY, Authorization: `Bearer ${token}` }
                }),
                getStorageStatsStorageFilesStatsGet({
                    headers: { 'X-API-Key': API_KEY, Authorization: `Bearer ${token}` }
                }),
                listFunctionsFunctionsGet({
                    headers: { 'X-API-Key': API_KEY, Authorization: `Bearer ${token}` }
                }),
                listWebhooksWebhooksGet({
                    headers: { 'X-API-Key': API_KEY, Authorization: `Bearer ${token}` }
                })
            ]);
            const storageStats = storageRes.data;
            console.log(`[DEBUG ${context}] Actual DB counts - Users: ${usersRes.data}, Tables: ${tablesRes.data}, Buckets: ${storageStats?.bucket_count}, Storage: ${storageStats?.total_size}, Functions: ${functionsRes.data?.total}, Webhooks: ${webhooksRes.data?.total}`);
            return {
                actualUsers: usersRes.data,
                actualTables: tablesRes.data,
                actualBuckets: storageStats?.bucket_count,
                actualStorageSize: storageStats?.total_size,
                actualFunctions: functionsRes.data?.total,
                actualWebhooks: webhooksRes.data?.total
            };
        } catch (e) {
            console.error(`[DEBUG ${context}] Failed to fetch actual counts`, e);
            return { actualUsers: null, actualTables: null, actualBuckets: null, actualStorageSize: null, actualFunctions: null, actualWebhooks: null };
        }
    };

    // Fetch initial counts
    useEffect(() => {
        const fetchStats = async () => {
            if (!token) return;
            try {
                const usersResponse = await getUserCountUsersCountGet({
                    headers: {
                        'X-API-Key': API_KEY,
                        Authorization: `Bearer ${token}`,
                    }
                });
                if (usersResponse.data !== undefined) setUserCount(usersResponse.data);

                const tablesResponse = await getTableCountTablesCountGet({
                    headers: {
                        'X-API-Key': API_KEY,
                        Authorization: `Bearer ${token}`,
                    }
                });
                if (tablesResponse.data !== undefined) setTableCount(tablesResponse.data);

                // Fetch storage stats from the new endpoint
                const storageResponse = await getStorageStatsStorageFilesStatsGet({
                    headers: {
                        'X-API-Key': API_KEY,
                        Authorization: `Bearer ${token}`,
                    }
                });
                if (storageResponse.data) {
                    setBucketCount(storageResponse.data.bucket_count);
                    setTotalStorageSize(storageResponse.data.total_size);
                }

                // Fetch functions count
                const functionsResponse = await listFunctionsFunctionsGet({
                    headers: {
                        'X-API-Key': API_KEY,
                        Authorization: `Bearer ${token}`,
                    }
                });
                if (functionsResponse.data?.total !== undefined) {
                    setFunctionCount(functionsResponse.data.total);
                }

                // Fetch webhooks count
                const webhooksResponse = await listWebhooksWebhooksGet({
                    headers: {
                        'X-API-Key': API_KEY,
                        Authorization: `Bearer ${token}`,
                    }
                });
                if (webhooksResponse.data?.total !== undefined) {
                    setWebhookCount(webhooksResponse.data.total);
                }

                initialFetchDone.current = true;
            } catch (error) {
                console.error('Failed to fetch stats', error);
            }
        };
        fetchStats();
    }, [token]);

    // Subscribe to realtime updates for users and tables
    useEffect(() => {
        if (!realtime) return;

        // Track connection status
        // setIsRealtimeConnected(realtime.isConnected);

        // const handleConnect = () => setIsRealtimeConnected(true);
        // const handleDisconnect = () => setIsRealtimeConnected(false);

        // realtime.onConnect(handleConnect);
        // realtime.onDisconnect(handleDisconnect);

        // Subscribe to users table changes (system users table only)
        const usersChannel = realtime.channel('table:users');
        usersChannel
            .on('INSERT', async (payload) => {
                // Only count if initial fetch is done and this is a real INSERT on users table
                const eventType = payload.event?.toUpperCase();

                if (initialFetchDone.current && payload.table === 'users' && eventType === 'INSERT') {
                    console.log('[Dashboard] Users INSERT detected', payload);
                    // Fetch actual count from DB to ensure accuracy (avoids race conditions)
                    const { actualUsers } = await fetchActualCounts('Users INSERT');
                    if (actualUsers !== null && actualUsers !== undefined) {
                        setUserCount(actualUsers);
                        console.log(`[Dashboard] Users INSERT - synced to actual DB count: ${actualUsers}`);
                    }
                }
            })
            .on('DELETE', async (payload) => {
                const eventType = payload.event?.toUpperCase();

                if (initialFetchDone.current && payload.table === 'users' && eventType === 'DELETE') {
                    console.log('[Dashboard] Users DELETE detected', payload);
                    // Fetch actual count from DB to ensure accuracy
                    const { actualUsers } = await fetchActualCounts('Users DELETE');
                    if (actualUsers !== null && actualUsers !== undefined) {
                        setUserCount(actualUsers);
                        console.log(`[Dashboard] Users DELETE - synced to actual DB count: ${actualUsers}`);
                    }
                }
            })
            .subscribe();

        // Subscribe to tables table changes (system tables metadata table only)
        const tablesChannel = realtime.channel('table:tables');
        tablesChannel
            .on('INSERT', async (payload) => {
                // Only count if initial fetch is done and this is a real INSERT with table_schema
                const eventType = payload.event?.toUpperCase();

                if (initialFetchDone.current && payload.table === 'tables' && eventType === 'INSERT' && payload.new?.table_schema) {
                    console.log('[Dashboard] Tables INSERT detected', payload);
                    // Fetch actual count from DB to ensure accuracy (avoids race conditions)
                    const { actualTables } = await fetchActualCounts('Tables INSERT');
                    if (actualTables !== null && actualTables !== undefined) {
                        setTableCount(actualTables);
                        console.log(`[Dashboard] Tables INSERT - synced to actual DB count: ${actualTables}`);
                    }
                }
            })
            .on('DELETE', async (payload) => {
                const eventType = payload.event?.toUpperCase();

                if (initialFetchDone.current && payload.table === 'tables' && eventType === 'DELETE' && payload.old?.table_schema) {
                    console.log('[Dashboard] Tables DELETE detected', payload);
                    // Fetch actual count from DB to ensure accuracy
                    const { actualTables } = await fetchActualCounts('Tables DELETE');
                    if (actualTables !== null && actualTables !== undefined) {
                        setTableCount(actualTables);
                        console.log(`[Dashboard] Tables DELETE - synced to actual DB count: ${actualTables}`);
                    }
                }
            })
            .subscribe();

        // Subscribe to buckets table changes
        const bucketsChannel = realtime.channel('table:buckets');
        bucketsChannel
            .on('INSERT', async (payload) => {
                const eventType = payload.event?.toUpperCase();

                if (initialFetchDone.current && payload.table === 'buckets' && eventType === 'INSERT') {
                    console.log('[Dashboard] Buckets INSERT detected', payload);
                    const { actualBuckets } = await fetchActualCounts('Buckets INSERT');
                    if (actualBuckets !== null && actualBuckets !== undefined) {
                        setBucketCount(actualBuckets);
                        console.log(`[Dashboard] Buckets INSERT - synced to actual DB count: ${actualBuckets}`);
                    }
                }
            })
            .on('DELETE', async (payload) => {
                const eventType = payload.event?.toUpperCase();

                if (initialFetchDone.current && payload.table === 'buckets' && eventType === 'DELETE') {
                    console.log('[Dashboard] Buckets DELETE detected', payload);
                    const { actualBuckets } = await fetchActualCounts('Buckets DELETE');
                    if (actualBuckets !== null && actualBuckets !== undefined) {
                        setBucketCount(actualBuckets);
                        console.log(`[Dashboard] Buckets DELETE - synced to actual DB count: ${actualBuckets}`);
                    }
                }
            })
            .subscribe();

        // Subscribe to files table changes (for total storage size updates)
        const filesChannel = realtime.channel('table:files');
        filesChannel
            .on('INSERT', async (payload) => {
                const eventType = payload.event?.toUpperCase();

                if (initialFetchDone.current && payload.table === 'files' && eventType === 'INSERT') {
                    console.log('[Dashboard] Files INSERT detected', payload);
                    const { actualStorageSize } = await fetchActualCounts('Files INSERT');
                    if (actualStorageSize !== null && actualStorageSize !== undefined) {
                        setTotalStorageSize(actualStorageSize);
                        console.log(`[Dashboard] Files INSERT - synced to actual storage size: ${actualStorageSize}`);
                    }
                }
            })
            .on('DELETE', async (payload) => {
                const eventType = payload.event?.toUpperCase();

                if (initialFetchDone.current && payload.table === 'files' && eventType === 'DELETE') {
                    console.log('[Dashboard] Files DELETE detected', payload);
                    const { actualStorageSize } = await fetchActualCounts('Files DELETE');
                    if (actualStorageSize !== null && actualStorageSize !== undefined) {
                        setTotalStorageSize(actualStorageSize);
                        console.log(`[Dashboard] Files DELETE - synced to actual storage size: ${actualStorageSize}`);
                    }
                }
            })
            .subscribe();

        // Subscribe to functions table changes
        const functionsChannel = realtime.channel('table:functions');
        functionsChannel
            .on('INSERT', async (payload) => {
                const eventType = payload.event?.toUpperCase();

                if (initialFetchDone.current && payload.table === 'functions' && eventType === 'INSERT') {
                    console.log('[Dashboard] Functions INSERT detected', payload);
                    const { actualFunctions } = await fetchActualCounts('Functions INSERT');
                    if (actualFunctions !== null && actualFunctions !== undefined) {
                        setFunctionCount(actualFunctions);
                        console.log(`[Dashboard] Functions INSERT - synced to actual DB count: ${actualFunctions}`);
                    }
                }
            })
            .on('DELETE', async (payload) => {
                const eventType = payload.event?.toUpperCase();

                if (initialFetchDone.current && payload.table === 'functions' && eventType === 'DELETE') {
                    console.log('[Dashboard] Functions DELETE detected', payload);
                    const { actualFunctions } = await fetchActualCounts('Functions DELETE');
                    if (actualFunctions !== null && actualFunctions !== undefined) {
                        setFunctionCount(actualFunctions);
                        console.log(`[Dashboard] Functions DELETE - synced to actual DB count: ${actualFunctions}`);
                    }
                }
            })
            .subscribe();

        // Subscribe to webhooks table changes
        const webhooksChannel = realtime.channel('table:webhooks');
        webhooksChannel
            .on('INSERT', async (payload) => {
                const eventType = payload.event?.toUpperCase();

                if (initialFetchDone.current && payload.table === 'webhooks' && eventType === 'INSERT') {
                    console.log('[Dashboard] Webhooks INSERT detected', payload);
                    const { actualWebhooks } = await fetchActualCounts('Webhooks INSERT');
                    if (actualWebhooks !== null && actualWebhooks !== undefined) {
                        setWebhookCount(actualWebhooks);
                        console.log(`[Dashboard] Webhooks INSERT - synced to actual DB count: ${actualWebhooks}`);
                    }
                }
            })
            .on('DELETE', async (payload) => {
                const eventType = payload.event?.toUpperCase();

                if (initialFetchDone.current && payload.table === 'webhooks' && eventType === 'DELETE') {
                    console.log('[Dashboard] Webhooks DELETE detected', payload);
                    const { actualWebhooks } = await fetchActualCounts('Webhooks DELETE');
                    if (actualWebhooks !== null && actualWebhooks !== undefined) {
                        setWebhookCount(actualWebhooks);
                        console.log(`[Dashboard] Webhooks DELETE - synced to actual DB count: ${actualWebhooks}`);
                    }
                }
            })
            .subscribe();

        // Cleanup subscriptions on unmount
        return () => {
            usersChannel.unsubscribe();
            tablesChannel.unsubscribe();
            bucketsChannel.unsubscribe();
            filesChannel.unsubscribe();
            functionsChannel.unsubscribe();
            webhooksChannel.unsubscribe();
        };
    }, [realtime]);

    const stats = [
        { name: 'Total Users', value: userCount, icon: Users, href: '/users', color: 'from-blue-500 to-blue-600', iconColor: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-500/10', displayValue: String(userCount) },
        { name: 'Total Tables', value: tableCount, icon: Database, href: '/tables', color: 'from-emerald-500 to-emerald-600', iconColor: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-500/10', displayValue: String(tableCount) },
        { name: 'Storage', value: bucketCount, icon: FolderOpen, href: '/storage', color: 'from-violet-500 to-violet-600', iconColor: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-50 dark:bg-violet-500/10', displayValue: formatSize(totalStorageSize), subtitle: `${bucketCount} bucket${bucketCount !== 1 ? 's' : ''}` },
        { name: 'Functions', value: functionCount, icon: Code, href: '/functions', color: 'from-amber-500 to-amber-600', iconColor: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-500/10', displayValue: String(functionCount) },
        { name: 'Webhooks', value: webhookCount, icon: Webhook, color: 'from-rose-500 to-rose-600', iconColor: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-50 dark:bg-rose-500/10', displayValue: String(webhookCount), hideViewMore: true },
    ];

    return (
        <div className="h-[var(--page-content-height)] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between mb-6 flex-shrink-0">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Dashboard Overview</h1>
                    <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">Welcome back to your project overview.</p>
                </div>
            </div>

            {/* Content Area - Split into Stats/Main and Sidebar */}
            <div className="flex flex-col lg:flex-row flex-1 min-h-0 gap-6 overflow-y-auto lg:overflow-hidden">

                {/* Left: Stats Grid */}
                <div className="flex-shrink-0 lg:flex-1 lg:flex lg:flex-col lg:min-w-0 lg:overflow-y-auto p-1">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {stats.map((item) => (
                            <Link
                                key={item.name}
                                to={item.href || '#'}
                                className={`group relative overflow-hidden rounded-xl bg-white dark:bg-slate-800 p-4 shadow-sm ring-1 ring-gray-200 dark:ring-slate-700 transition-all duration-200 hover:shadow-md hover:ring-gray-300 dark:hover:ring-slate-600 ${!item.href ? 'cursor-default' : ''}`}
                                onClick={(e) => !item.href && e.preventDefault()}
                            >
                                <dt className="flex items-center gap-3">
                                    <div className={`rounded-lg ${item.bg} p-2 transition-colors group-hover:bg-opacity-80`}>
                                        <item.icon className={`h-5 w-5 ${item.iconColor}`} aria-hidden="true" />
                                    </div>
                                    <p className="truncate text-sm font-medium text-gray-500 dark:text-slate-400">{item.name}</p>
                                </dt>
                                <dd className="mt-3 flex items-baseline">
                                    <p className="text-2xl font-bold text-gray-900 dark:text-white">{item.displayValue}</p>
                                    {item.subtitle && (
                                        <span className="ml-2 text-xs text-gray-500 dark:text-slate-400">({item.subtitle})</span>
                                    )}
                                </dd>
                                {item.href && !item.hideViewMore && (
                                    <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <ArrowRight className="h-4 w-4 text-gray-400 dark:text-slate-500" />
                                    </div>
                                )}
                            </Link>
                        ))}
                    </div>
                    {/* Empty space below - only needed on desktop to push content up if using flex column, but here grid handles it. On mobile it naturally flows. */}
                    <div className="hidden lg:block flex-1"></div>
                </div>

                {/* Right: Sidebar Card */}
                {/* Mobile: w-full, h-auto. Desktop: w-80, h-full, scrollable */}
                <div className="w-full lg:w-80 flex-shrink-0 flex flex-col p-1 lg:p-0">
                    <div className="h-auto lg:h-full bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4 shadow-sm lg:overflow-y-auto">
                        <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-3">Quick Actions</h2>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2">
                            {/* On mobile/tablet (sm-md), sidebar items can be side-by-side if they are wide? Or just stacking is fine. Kept simple for now but added sm:grid-cols-2 just in case it looks too stretched. Actually, w-full stack is safer. Let's revert grid change inside sidebar for simplicity unless requested.  */}
                            {/* Reverting to space-y-2 for consistency with desktop list view, simpler for now. */}
                            <div className="flex flex-col gap-2">
                                <Link
                                    to="/users"
                                    className="group flex items-center gap-3 rounded-lg p-2 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors"
                                >
                                    <div className="rounded-md bg-blue-50 dark:bg-blue-500/10 p-2 text-blue-600 dark:text-blue-400 group-hover:bg-blue-100 dark:group-hover:bg-blue-500/20 transition-colors">
                                        <Users className="h-4 w-4" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h3 className="text-sm font-medium text-gray-900 dark:text-white truncate">Manage Users</h3>
                                        <p className="text-xs text-gray-500 dark:text-slate-400 truncate">Add or remove users</p>
                                    </div>
                                    <ArrowRight className="h-4 w-4 text-gray-300 dark:text-slate-600 group-hover:text-gray-500 dark:group-hover:text-slate-400 transition-colors" />
                                </Link>
                                <Link
                                    to="/tables"
                                    className="group flex items-center gap-3 rounded-lg p-2 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors"
                                >
                                    <div className="rounded-md bg-emerald-50 dark:bg-emerald-500/10 p-2 text-emerald-600 dark:text-emerald-400 group-hover:bg-emerald-100 dark:group-hover:bg-emerald-500/20 transition-colors">
                                        <Database className="h-4 w-4" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h3 className="text-sm font-medium text-gray-900 dark:text-white truncate">Manage Tables</h3>
                                        <p className="text-xs text-gray-500 dark:text-slate-400 truncate">Create and manage tables</p>
                                    </div>
                                    <ArrowRight className="h-4 w-4 text-gray-300 dark:text-slate-600 group-hover:text-gray-500 dark:group-hover:text-slate-400 transition-colors" />
                                </Link>
                                <Link
                                    to="/storage"
                                    className="group flex items-center gap-3 rounded-lg p-2 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors"
                                >
                                    <div className="rounded-md bg-violet-50 dark:bg-violet-500/10 p-2 text-violet-600 dark:text-violet-400 group-hover:bg-violet-100 dark:group-hover:bg-violet-500/20 transition-colors">
                                        <FolderOpen className="h-4 w-4" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h3 className="text-sm font-medium text-gray-900 dark:text-white truncate">Manage Storage</h3>
                                        <p className="text-xs text-gray-500 dark:text-slate-400 truncate">Upload files and buckets</p>
                                    </div>
                                    <ArrowRight className="h-4 w-4 text-gray-300 dark:text-slate-600 group-hover:text-gray-500 dark:group-hover:text-slate-400 transition-colors" />
                                </Link>
                                <Link
                                    to="/functions"
                                    className="group flex items-center gap-3 rounded-lg p-2 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors"
                                >
                                    <div className="rounded-md bg-amber-50 dark:bg-amber-500/10 p-2 text-amber-600 dark:text-amber-400 group-hover:bg-amber-100 dark:group-hover:bg-amber-500/20 transition-colors">
                                        <Code className="h-4 w-4" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h3 className="text-sm font-medium text-gray-900 dark:text-white truncate">Serverless Functions</h3>
                                        <p className="text-xs text-gray-500 dark:text-slate-400 truncate">Deploy and manage</p>
                                    </div>
                                    <ArrowRight className="h-4 w-4 text-gray-300 dark:text-slate-600 group-hover:text-gray-500 dark:group-hover:text-slate-400 transition-colors" />
                                </Link>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
