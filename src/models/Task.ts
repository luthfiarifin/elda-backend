import mongoose, { Schema, Document, Model } from 'mongoose';

// Interface representing a document in MongoDB.
export interface ITask extends Document {
    prompt: string;
    description: string;
    time?: string; // Optional field
    isCompleted: boolean;
    // userId?: mongoose.Schema.Types.ObjectId; // Uncomment if using user linking
    createdAt: Date;
}

// Schema definition
const TaskSchema: Schema<ITask> = new Schema({
    prompt: {
        type: String,
        required: true,
        trim: true,
    },
    description: {
        type: String,
        required: true,
        trim: true,
    },
    time: {
        type: String,
        trim: true,
    },
    isCompleted: {
        type: Boolean,
        default: false,
    },
    // userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

// Export the model
const TaskModel: Model<ITask> = mongoose.model<ITask>('Task', TaskSchema);

export default TaskModel;