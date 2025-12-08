import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');

async function main() {
    console.log('Initializing PocketBase Schema (Automated Step-by-Step)...');

    const email = 'erkut.tekoglu@gmail.com';
    const password = 'ErkuTT3931**';

    try {
        await pb.admins.authWithPassword(email, password);
        console.log('Logged in as admin.');
    } catch (e) {
        console.error("Authentication failed:", e.message);
        process.exit(1);
    }

    let scansCollection;
    try {
        const list = await pb.collections.getList(1, 1, { filter: 'name="scans"' });
        if (list.items.length > 0) {
            scansCollection = list.items[0];
            await pb.collections.delete(scansCollection.id);
            scansCollection = null;
        }

        if (!scansCollection) {
            scansCollection = await pb.collections.create({
                name: 'scans',
                type: 'base',
                fields: [
                    { name: 'user_id', type: 'text', required: true }
                ]
            });
            console.log('Created "scans" collection.');
        }

        // Refresh ID
        scansCollection = await pb.collections.getOne(scansCollection.id);
        console.log('Scans ID:', scansCollection.id);

    } catch (e) {
        console.error('Error managing "scans":', e.message);
        process.exit(1);
    }

    let usersCollection;
    try {
        const list = await pb.collections.getList(1, 1, { filter: 'name="instagram_users"' });
        if (list.items.length > 0) {
            await pb.collections.delete(list.items[0].id);
        }

        console.log('Creating "instagram_users" collection (base fields)...');

        // Create WITHOUT relation first
        usersCollection = await pb.collections.create({
            name: 'instagram_users',
            type: 'base',
            fields: [
                { name: 'username', type: 'text', required: false },
                { name: 'full_name', type: 'text', required: false },
                { name: 'user_id', type: 'text', required: false },
                { name: 'profile_pic_url', type: 'url', required: false },
                { name: 'is_private', type: 'bool', required: false },
                { name: 'is_verified', type: 'bool', required: false },
                { name: 'followed_by_viewer', type: 'bool', required: false },
                { name: 'follows_viewer', type: 'bool', required: false },
                { name: 'requested_by_viewer', type: 'bool', required: false },
            ]
        });
        console.log('Created "instagram_users" base collection.');

    } catch (e) {
        console.error('Error creating base "instagram_users":', e.message);
        if (e.data) console.error(JSON.stringify(e.data, null, 2));
        process.exit(1);
    }

    // Now try to add the relation field
    try {
        console.log('Adding "scan_id" relation field...');

        // We need to fetch the collection struct again or use the one we have? 
        // We likely need to append to fields array.
        // Actually, update() replaces fields? Or merges?
        // PocketBase update() usually replaces the field configuration if you send fields array.
        // So we need to send ALL fields + new one.

        // Let's assume usersCollection contains the current fields.
        // We append the new one.

        const currentFields = usersCollection.fields; // This should be an array

        const newField = {
            name: 'scan_id',
            type: 'relation',
            required: true,
            collectionId: scansCollection.id,
            cascadeDelete: true,
            maxSelect: 1
        };

        const updatedFields = [...currentFields, newField];

        console.log('Updating with new field...');
        console.log('Collection ID used for relation:', scansCollection.id);

        await pb.collections.update(usersCollection.id, {
            fields: updatedFields
        });

        console.log('Successfully added "scan_id" relation.');

    } catch (e) {
        console.error('Error adding relation field:', e.message);
        if (e.data) console.error('Validation errors:', JSON.stringify(e.data, null, 2));
        process.exit(1);
    }
}

main();
