import mongoose, { Schema } from "mongoose";
import bcrypt from "bcryptjs";

export interface IUser {
    email: string;
    password: string;
    name: string;
    createdAt: Date;
    comparePassword(candidatePassword: string): Promise<boolean>;
}

const userSchema = new Schema<IUser>({
    email: { 
        type: String, 
        required: true, 
        unique: true,
        lowercase: true,
        trim: true 
    },
    password: { 
        type: String, 
        required: true,
        minlength: 8 
    },
    name: { 
        type: String, 
        required: true,
        trim: true 
    },
    createdAt: { 
        type: Date, 
        default: Date.now 
    }
});

// Hash password before saving
userSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    
    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error as Error);
    }
});

// Method to compare passwords
userSchema.methods.comparePassword = async function(candidatePassword: string): Promise<boolean> {
    return bcrypt.compare(candidatePassword, this.password);
};

export default mongoose.model<IUser>('User', userSchema); 