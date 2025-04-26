import mongoose, { Schema, Document, Model } from 'mongoose';

// Interface representing a document in MongoDB.
export interface IContact extends Document {
    name: string;
    phoneNumber: string;
    prompt: string;
    relationship?: string; // Optional field
    // userId?: mongoose.Schema.Types.ObjectId; // Uncomment if using user linking
    createdAt: Date;
}

// Schema definition
const ContactSchema: Schema<IContact> = new Schema({
    name: {
        type: String,
        required: true,
        trim: true,
    },
    phoneNumber: {
        type: String,
        required: true,
        trim: true,
    },
    prompt: {
        type: String,
        required: true,
        trim: true,
    },
    relationship: {
        type: String,
        trim: true,
    },
    // userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

// Export the model
// Mongoose automatically infers the model type from the schema and interface
const ContactModel: Model<IContact> = mongoose.model<IContact>('Contact', ContactSchema);

export default ContactModel;