import { MemoryFragmentService } from '../services/memoryFragmentService.js';
import { ChapterGeneratorService } from '../services/chapterGeneratorService.js';
import { TimePeriod } from '../types/common.js';
import { ChapterType } from '../types/chapter.js';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const testMemories = [
    {
        status: 'complete' as const,
        title: "First Day of School",
        description: "I remember my first day of kindergarten vividly. My mom walked me to class, holding my hand tightly. I was wearing my new red backpack and light-up sneakers. The classroom smelled like crayons and play-doh.",
        date: {
            timestamp: new Date('1995-09-01'),
            approximateDate: "Fall 1995",
            timePeriod: TimePeriod.Past
        },
        location: {
            name: "Springfield Elementary School",
            coordinates: undefined
        },
        people: [
            { name: "Mom", relationship: "mother" },
            { name: "Mrs. Thompson", relationship: "teacher" }
        ],
        tags: ["school", "childhood", "milestone"],
        context: {
            emotions: ["nervous", "excited"],
            significance: 5,
            themes: ["childhood", "family", "education", "beginnings"]
        },
        system: {
            userId: "test-user-123",
            createdAt: new Date(),
            updatedAt: new Date(),
            version: 1
        }
    },
    {
        status: 'complete' as const,
        title: "Christmas Morning 1996",
        description: "Waking up at dawn, racing downstairs in my pajamas. The living room was magical - twinkling lights, presents under the tree. Dad filming everything on his camcorder while Mom made hot chocolate.",
        date: {
            timestamp: new Date('1996-12-25'),
            approximateDate: "Winter 1996",
            timePeriod: TimePeriod.Past
        },
        location: {
            name: "Family Home",
            coordinates: undefined
        },
        people: [
            { name: "Mom", relationship: "mother" },
            { name: "Dad", relationship: "father" }
        ],
        tags: ["christmas", "family", "tradition"],
        context: {
            emotions: ["joy", "wonder"],
            significance: 5,
            themes: ["childhood", "family", "tradition", "happiness"]
        },
        system: { userId: "test-user-123", createdAt: new Date(), updatedAt: new Date(), version: 1 }
    },
    {
        status: 'complete' as const,
        title: "Learning to Ride a Bike",
        description: "Dad running alongside me on the sidewalk, holding the back of my bike. The moment he let go and I kept going - pure freedom. The wind in my face, my heart racing with pride.",
        date: {
            timestamp: new Date('1996-06-15'),
            approximateDate: "Summer 1996",
            timePeriod: TimePeriod.Past
        },
        location: {
            name: "Neighborhood Street",
            coordinates: undefined
        },
        people: [
            { name: "Dad", relationship: "father" }
        ],
        tags: ["milestone", "learning", "outdoor"],
        context: {
            emotions: ["proud", "excited", "fearless"],
            significance: 4,
            themes: ["childhood", "achievement", "father-child bond"]
        },
        system: { userId: "test-user-123", createdAt: new Date(), updatedAt: new Date(), version: 1 }
    },
    {
        status: 'complete' as const,
        title: "Grandma's Cookie Day",
        description: "The kitchen was warm and filled with the smell of vanilla and cinnamon. Grandma letting me stand on a chair to help mix the dough, teaching me her secret recipe. Flour on my nose, her gentle laugh, the way she'd sneak me extra chocolate chips.",
        date: {
            timestamp: new Date('1996-03-10'),
            approximateDate: "Spring 1996",
            timePeriod: TimePeriod.Past
        },
        location: {
            name: "Grandma's House",
            coordinates: undefined
        },
        people: [
            { name: "Grandma", relationship: "grandmother" }
        ],
        tags: ["cooking", "family", "tradition", "learning"],
        context: {
            emotions: ["joy", "love", "contentment"],
            significance: 5,
            themes: ["childhood", "family", "tradition", "learning", "grandmother-child bond"]
        },
        system: { userId: "test-user-123", createdAt: new Date(), updatedAt: new Date(), version: 1 }
    },
    {
        status: 'complete' as const,
        title: "First Lost Tooth",
        description: "Wiggling my loose tooth at the breakfast table, then the surprise when it finally came out in my toast. Mom's excited gasp, running to the mirror to see the gap in my smile. The special tooth fairy pillow we made together.",
        date: {
            timestamp: new Date('1996-04-22'),
            approximateDate: "Spring 1996",
            timePeriod: TimePeriod.Past
        },
        location: {
            name: "Family Kitchen",
            coordinates: undefined
        },
        people: [
            { name: "Mom", relationship: "mother" }
        ],
        tags: ["milestone", "growing up", "family"],
        context: {
            emotions: ["excited", "proud", "surprised"],
            significance: 4,
            themes: ["childhood", "growth", "family rituals"]
        },
        system: { userId: "test-user-123", createdAt: new Date(), updatedAt: new Date(), version: 1 }
    },
    {
        status: 'complete' as const,
        title: "Backyard Camping Adventure",
        description: "Dad setting up the tent in our backyard, teaching me how to secure the poles. Making shadow puppets with flashlights, telling ghost stories, and pointing out constellations. The exciting feeling of sleeping under the stars.",
        date: {
            timestamp: new Date('1996-07-20'),
            approximateDate: "Summer 1996",
            timePeriod: TimePeriod.Past
        },
        location: {
            name: "Family Backyard",
            coordinates: undefined
        },
        people: [
            { name: "Dad", relationship: "father" }
        ],
        tags: ["adventure", "outdoors", "learning", "family"],
        context: {
            emotions: ["adventurous", "safe", "curious"],
            significance: 4,
            themes: ["childhood", "father-child bond", "exploration", "nature"]
        },
        system: { userId: "test-user-123", createdAt: new Date(), updatedAt: new Date(), version: 1 }
    },
    {
        status: 'complete' as const,
        title: "First Pet Fish",
        description: "Picking out my very first pet at the store - a bright blue betta fish. Dad helping me set up the tank, learning about responsibility. Named him Splash. The pride of feeding him every morning by myself.",
        date: {
            timestamp: new Date('1996-09-15'),
            approximateDate: "Fall 1996",
            timePeriod: TimePeriod.Past
        },
        location: {
            name: "Pet Store & Home",
            coordinates: undefined
        },
        people: [
            { name: "Dad", relationship: "father" }
        ],
        tags: ["pets", "responsibility", "learning"],
        context: {
            emotions: ["excited", "proud", "responsible"],
            significance: 4,
            themes: ["childhood", "responsibility", "care", "growing up"]
        },
        system: { userId: "test-user-123", createdAt: new Date(), updatedAt: new Date(), version: 1 }
    },
    {
        status: 'complete' as const,
        title: "Saturday Morning Cartoons",
        description: "Waking up early every Saturday, dragging my blanket to the living room. Mom making special chocolate chip pancakes. The excitement of watching my favorite shows, the comfort of our weekly ritual.",
        date: {
            timestamp: new Date('1996-02-03'),
            approximateDate: "Winter 1996",
            timePeriod: TimePeriod.Past
        },
        location: {
            name: "Family Living Room",
            coordinates: undefined
        },
        people: [
            { name: "Mom", relationship: "mother" }
        ],
        tags: ["routine", "family", "comfort"],
        context: {
            emotions: ["happy", "content", "peaceful"],
            significance: 4,
            themes: ["childhood", "family rituals", "simple pleasures"]
        },
        system: { userId: "test-user-123", createdAt: new Date(), updatedAt: new Date(), version: 1 }
    },
    {
        status: 'complete' as const,
        title: "Building a Tree Fort",
        description: "Spending weekends with Dad building our secret fort in the old oak tree. The smell of fresh wood, learning to use tools safely, planning our design together. Finally finishing and having our first picnic up there.",
        date: {
            timestamp: new Date('1996-08-10'),
            approximateDate: "Summer 1996",
            timePeriod: TimePeriod.Past
        },
        location: {
            name: "Backyard Oak Tree",
            coordinates: undefined
        },
        people: [
            { name: "Dad", relationship: "father" }
        ],
        tags: ["project", "building", "outdoors"],
        context: {
            emotions: ["accomplished", "proud", "creative"],
            significance: 5,
            themes: ["childhood", "father-child bond", "achievement", "creativity"]
        },
        system: { userId: "test-user-123", createdAt: new Date(), updatedAt: new Date(), version: 1 }
    },
    {
        status: 'complete' as const,
        title: "First Piano Recital",
        description: "Practicing for weeks on 'Twinkle Twinkle Little Star'. Mom helping me pick out my special dress. The butterflies in my stomach before playing, then the huge smile and applause after finishing without any mistakes.",
        date: {
            timestamp: new Date('1996-05-15'),
            approximateDate: "Spring 1996",
            timePeriod: TimePeriod.Past
        },
        location: {
            name: "Community Center",
            coordinates: undefined
        },
        people: [
            { name: "Mom", relationship: "mother" },
            { name: "Ms. Davis", relationship: "piano teacher" }
        ],
        tags: ["music", "performance", "achievement"],
        context: {
            emotions: ["nervous", "proud", "accomplished"],
            significance: 5,
            themes: ["childhood", "achievement", "performing arts", "overcoming fears"]
        },
        system: { userId: "test-user-123", createdAt: new Date(), updatedAt: new Date(), version: 1 }
    }
];

async function connectDB() {
    try {
        await mongoose.connect(process.env.MONGO_URI!);
        console.log('Connected to MongoDB');
    } catch (error) {
        console.error('MongoDB connection error:', error);
        process.exit(1);
    }
}

async function testRootsChapterGeneration() {
    try {
        await connectDB();
        
        const memoryService = new MemoryFragmentService();
        const chapterGenerator = new ChapterGeneratorService();
        
        // Store test memories
        console.log('\n=== Storing Memories ===');
        const userId = "test-user-123";
        const storedMemories = await Promise.all(
            testMemories.map(async memory => {
                const stored = await memoryService.createMemoryFragment(userId, memory);
                console.log(`✓ Stored: ${stored.title}`);
                return stored;
            })
        );
        
        console.log(`\nTotal memories stored: ${storedMemories.length}`);

        // Retrieve memories
        const userMemories = await memoryService.getUserMemories(userId);
        console.log(`\n=== Retrieved ${userMemories.length} memories ===`);
        
        // Convert to MemoryFragment format
        const memories = userMemories.map(doc => ({
            ...doc.toObject(),
            id: doc._id
        }));

        // Generate Roots chapter
        console.log('\n=== Generating Roots Chapter ===');
        console.log('Processing memories...');
        
        const rootsChapter = await chapterGenerator.generateChapter(
            ChapterType.ROOTS,
            memories
        );

        // Log results in a formatted way
        console.log('\n=== Generated Chapter ===');
        console.log('Title:', rootsChapter.title);
        
        console.log('\n--- Opening ---');
        console.log(rootsChapter.content?.opening);
        
        console.log('\n--- Body ---');
        console.log(rootsChapter.content?.body);
        
        console.log('\n--- Closing ---');
        console.log(rootsChapter.content?.closing);
        
        console.log('\n=== Chapter Metadata ===');
        console.log('Time Period:', 
            `${rootsChapter.metadata.timeframe.start.getFullYear()} - ${rootsChapter.metadata.timeframe.end.getFullYear()}`
        );
        console.log('\nThemes:', rootsChapter.metadata.themes);
        console.log('\nKey Characters:', rootsChapter.metadata.keyCharacters);
        console.log('\nEmotional Tones:', rootsChapter.metadata.emotionalTone);

    } catch (error) {
        console.error("Error in chapter generation test:", error);
    } finally {
        await mongoose.connection.close();
        console.log('\nMongoDB connection closed');
    }
}

// Run the test
console.log('Starting Roots chapter generation test...');
testRootsChapterGeneration().catch(console.error); 