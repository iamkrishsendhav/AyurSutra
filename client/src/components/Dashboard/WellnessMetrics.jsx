import React from "react";
import { Heart } from "lucide-react";

const WellnessMetrics = ({ data }) => {
  return (
    <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
      <h3 className="text-lg font-semibold mb-4 flex items-center">
        <Heart className="h-5 w-5 mr-2 text-red-500" />
        Recent Wellness Metrics
      </h3>
      {Number.isFinite(data?.wellnessScore) ? <div className="space-y-2"><p className="text-sm text-gray-600">Recorded wellness score</p><p className="text-lg font-medium">{data.wellnessScore}/10</p><div className="w-full bg-gray-200 rounded-full h-2"><div className="bg-purple-500 h-2 rounded-full" style={{ width: `${data.wellnessScore * 10}%` }} /></div></div> : <p className="text-sm text-gray-600">No wellness assessment has been recorded.</p>}
    </div>
  );
};

export default WellnessMetrics;
