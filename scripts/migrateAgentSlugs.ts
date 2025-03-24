import mongoose from 'mongoose';
import { generateSlug } from '../src/utils/slugUtils.js';
import AIProfile from '../src/models/aiProfileModel.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://sammykordi:SbcDSOAWJNaxS8pa@cluster0.z5taz.mongodb.net/main-character?retryWrites=true&w=majority&appName=Cluster0';

const migrate = async () => {
  await mongoose.connect(MONGODB_URI);
  
  const agents = await AIProfile.find({});
  const existingSlugs = agents.map(a => a.slug);

  for (const agent of agents) {
    if (!agent.slug || !/^[a-z0-9-]+$/.test(agent.slug)) {
      agent.slug = generateSlug(agent.name, existingSlugs);
      await agent.save();
      console.log(`Updated ${agent.name} => ${agent.slug}`);
    }
  }

  mongoose.disconnect();
};

migrate().catch(console.error); 