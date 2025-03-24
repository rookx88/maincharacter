import mongoose from 'mongoose';

beforeAll(async () => {
    await mongoose.connect(process.env.MONGO_URI!);
});

afterAll(async () => {
    await mongoose.connection.close();
});

afterEach(async () => {
    if (!mongoose.connection.db) {
        throw new Error('Database not connected');
    }
    const collections = await mongoose.connection.db.collections();
    for (const collection of collections) {
        await collection.deleteMany({});
    }
}); 