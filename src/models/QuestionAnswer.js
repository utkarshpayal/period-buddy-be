// models/QuestionAnswer.js

import mongoose from "mongoose";

const questionAnswerSchema = new mongoose.Schema(
  {
    question: {
      type: String,
      required: true,
      trim: true,
    },

    slug: {
      type: String,
      unique: true,
      index: true,
    },

    answer: {
      type: String,
      required: true,
    },

    shortAnswer: {
      type: String,
    },

    category: {
      type: String,
      required: true,
      enum: [
        "periods",
        "female_body",
        "male_body",
        "sexual_health",
        "mental_health",
        "pregnancy",
        "contraception",
        "masturbation",
        "pleasure",
        "hygiene",
        "diseases",
        "relationships",
        "puberty",
        "products",
        "fitness",
        "nutrition",
        "general",
        "symptoms",
        "fertility",
        "health",
        "tracking",
        "other",
      ],
      index: true,
    },

    subCategory: {
      type: String,
      trim: true,
      index: true,
    },

    bodyPart: [
      {
        type: String,
        enum: [
          "breast",
          "vagina",
          "vulva",
          "uterus",
          "ovary",
          "penis",
          "testicles",
          "skin",
          "hormones",
          "brain",
          "pelvis",
          "other",
        ],
      },
    ],

    gender: [
      {
        type: String,
        enum: ["female", "male", "all"],
      },
    ],

    ageGroups: [
      {
        type: String,
        enum: [
          "10-13",
          "14-17",
          "18-24",
          "25-34",
          "30-40",
          "45+",
        ],
      },
    ],

    tags: [
      {
        type: String,
        trim: true,
        lowercase: true,
        index: true,
      },
    ],

    symptoms: [
      {
        type: String,
        trim: true,
      },
    ],

    relatedProducts: [
      {
        type: String,
        trim: true,
      },
    ],

    difficultyLevel: {
      type: String,
      enum: ["basic", "intermediate", "advanced"],
      default: "basic",
    },

    contentType: {
      type: String,
      enum: [
        "educational",
        "medical",
        "awareness",
        "guide",
        "faq",
        "tips",
      ],
      default: "faq",
    },

    language: {
      type: String,
      default: "english",
    },

    isSensitive: {
      type: Boolean,
      default: false,
    },

    isPublished: {
      type: Boolean,
      default: true,
      index: true,
    },

    isFeatured: {
      type: Boolean,
      default: false,
    },

    seoTitle: String,
    seoDescription: String,

    views: {
      type: Number,
      default: 0,
    },

    likes: {
      type: Number,
      default: 0,
    },

    sourceLinks: [
      {
        type: String,
      },
    ],

    reviewedBy: {
      type: String,
    },

    medicallyReviewed: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

questionAnswerSchema.index({
  question: "text",
  answer: "text",
  tags: "text",
});

export default mongoose.model(
  "QuestionAnswer",
  questionAnswerSchema
);
