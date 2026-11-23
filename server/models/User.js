const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      default: function () {
        try {
          const email = this && this.email ? String(this.email) : "";
          if (email) {
            const local = email.split("@")[0] || "user";
            return local
              .replace(/[._-]+/g, " ")
              .replace(/\b\w/g, (c) => c.toUpperCase());
          }
        } catch (e) {}
        return "User";
      },
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: function () {
        return !this.googleId; // Password required only if not OAuth user
      },
    },
    googleId: {
      type: String,
      unique: true,
      sparse: true, // Allows multiple null values
    },
    provider: {
      type: String,
      enum: ["local", "google"],
      default: "local",
    },
    phone: {
      type: String,
    },
    userType: {
      type: String,
      enum: ["patient", "practitioner", "receptionist", "admin"],
      default: "patient",
    },
    assignedPractitioner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      // Make this optional to allow patient signup without assigning a practitioner immediately
    },
    status: {
      type: String,
      enum: ["active", "completed", "pending", "inactive"],
      default: "pending",
    },
    accountStatus: { type: String, enum: ['active', 'suspended'], default: 'active', index: true },
    mustChangePassword: { type: Boolean, default: false },
    accountStatusHistory: [{
      status: { type: String, enum: ['active', 'suspended'], required: true },
      changedAt: { type: Date, default: Date.now },
      changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    }],
    currentStage: {
      type: String,
      enum: [
        "Initial Assessment",
        "Treatment Phase",
        "Mid-therapy Assessment",
        "Advanced Treatment",
        "Final Assessment",
      ],
      default: "Initial Assessment",
    },
    treatmentStartDate: {
      type: Date,
    },
    progress: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
    wellnessScore: {
      type: Number,
      min: 0,
      max: 10,
      default: 0,
    },
    nextSessionDate: {
      type: Date,
    },
    progressHistory: [
      {
        date: {
          type: Date,
          default: Date.now,
        },
        progress: {
          type: Number,
          min: 0,
          max: 100,
        },
        stage: String,
        status: String,
        notes: String,
        recommendations: String,
        updatedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        updatedByName: String,
      },
    ],
    practitionerNotes: {
      type: String,
    },
    recommendations: {
      type: String,
    },
    medicalHistory: {
      conditions: [String],
      medications: [String],
      allergies: [String],
      previousTreatments: [String],
      previousSurgeries: [String],
      primaryConcerns: [String],
      treatmentGoals: [String],
      previousPanchakarma: { type: String, trim: true, maxlength: 1000 },
      patientReportedSymptoms: [String],
      lifestyle: {
        dietPreference: { type: String, trim: true, maxlength: 100 },
        activityLevel: { type: String, trim: true, maxlength: 100 },
        sleepPattern: { type: String, trim: true, maxlength: 300 },
        waterIntake: { type: String, trim: true, maxlength: 100 },
        notes: { type: String, trim: true, maxlength: 2000 },
      },
      healthNotes: { type: String, trim: true, maxlength: 5000 },
      // Patient-reported measurements; these are informational, not clinical readings.
      heightCm: { type: Number, min: 30, max: 250, default: null },
      weightKg: { type: Number, min: 2, max: 500, default: null },
    },
    address: {
      street: String,
      city: String,
      state: String,
      pincode: String,
      country: {
        type: String,
        default: "India",
      },
    },
    caregiverPhone: {
      type: String,
    },
    emergencyContact: {
      name: String,
      phone: String,
      relationship: String,
    },
    personalDetails: {
      dateOfBirth: Date,
      gender: {
        type: String,
        enum: ["male", "female", "other", "prefer_not_to_say", ""],
      },
      bloodGroup: {
        type: String,
        enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Unknown", ""],
      },
    },
    // Practitioner-specific fields
    licenseNumber: {
      type: String,
    },
    verificationStatus: {
      type: String,
      enum: ["pending", "verified", "rejected"],
      default: "pending",
    },
    verificationRequest: {
      submittedAt: Date,
      licenseNumber: String,
      additionalDocuments: String,
      adminNotes: String,
      reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      reviewedAt: Date,
    },
    // Practitioner location and availability
    practiceLocation: {
      address: String,
      city: String,
      state: String,
      pincode: String,
      country: {
        type: String,
        default: "India",
      },
      coordinates: {
        latitude: Number,
        longitude: Number,
      },
    },
    practiceAreas: [String], // e.g., ['Vamana', 'Virechana', 'Basti']
    qualifications: [String],
    profileImageUrl: { type: String, trim: true, maxlength: 2048 },
    availabilitySchedule: [{
      dayOfWeek: { type: String, enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] },
      startTime: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
      endTime: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
      isAvailable: { type: Boolean, default: true },
    }],
    professionalStatus: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
    consultationFee: {
      type: Number,
      default: 0,
    },
    availableForNewPatients: {
      type: Boolean,
      default: true,
    },
    bio: String,
    experience: {
      type: Number, // years of experience
      default: 0,
    },
    employeeId: { type: String, trim: true, maxlength: 40 },
    joiningDate: { type: Date },
    notificationPreferences: {
      inApp: { type: Boolean, default: true },
      categories: { type: Map, of: Boolean, default: {} },
      sessionReminders: { type: Boolean, default: true },
      followUpReminders: { type: Boolean, default: true },
      email: { type: Boolean, default: false },
    },
  },
  {
    timestamps: true,
  }
);

// Safety net: ensure `name` is always set before validation
UserSchema.pre("validate", function (next) {
  try {
    if (!this.name || String(this.name).trim().length === 0) {
      const email = this.email || "";
      let derived = "";
      if (email) {
        const local = String(email).split("@")[0] || "user";
        derived = local
          .replace(/[._-]+/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());
      }
      this.name = derived || "User";
    }
    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.model("User", UserSchema);
