import { supabase } from '../config/supabase.js';

export const dbService = {
    async logFeedback(feedbackData) {
        try {
            const { data, error } = await supabase
                .from('feedback_logs')
                .insert([{
                    user_id: feedbackData.userId,
                    whatsapp_number: feedbackData.whatsappNumber,
                    feedback: feedbackData.feedback,
                    request_id: feedbackData.requestId,
                    message_id: feedbackData.messageId,
                    reprocess_requested: feedbackData.reprocessRequested,
                    created_at: new Date().toISOString()
                }]);

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error logging feedback:', error);
            throw error;
        }
    },

    async getFeedbackStats(startDate, endDate) {
        try {
            const { data, error } = await supabase
                .from('feedback_logs')
                .select('*')
                .gte('created_at', startDate)
                .lte('created_at', endDate);

            if (error) throw error;

            return {
                total: data.length,
                positive: data.filter(f => f.feedback === 'positive').length,
                negative: data.filter(f => f.feedback === 'negative').length,
                reprocessRequested: data.filter(f => f.reprocess_requested).length
            };
        } catch (error) {
            console.error('Error getting feedback stats:', error);
            throw error;
        }
    },

    async getUserFeedbackHistory(userId) {
        try {
            const { data, error } = await supabase
                .from('feedback_logs')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error getting user feedback history:', error);
            throw error;
        }
    },

    async logJournalRequest(requestData) {
        try {
            const { data, error } = await supabase
                .from('journal_requests')
                .insert([{
                    request_id: requestData.requestId,
                    user_id: requestData.userId,
                    whatsapp_number: requestData.whatsappNumber,
                    status: requestData.status,
                    journal_url: requestData.journalUrl,
                    completion_time: requestData.completionTime,
                    error_message: requestData.error || null,
                    created_at: new Date().toISOString()
                }]);

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error logging journal request:', error);
            throw error;
        }
    },

    async updateJournalRequestStatus(requestId, status, error = null) {
        try {
            const { data, error: updateError } = await supabase
                .from('journal_requests')
                .update({
                    status: status,
                    error_message: error,
                    updated_at: new Date().toISOString()
                })
                .eq('request_id', requestId);

            if (updateError) throw updateError;
            return data;
        } catch (error) {
            console.error('Error updating journal request:', error);
            throw error;
        }
    },

    async getSystemStats(days = 30) {
        try {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            const { data, error } = await supabase
                .from('journal_requests')
                .select('*')
                .gte('created_at', startDate.toISOString());

            if (error) throw error;

            return {
                totalRequests: data.length,
                successfulRequests: data.filter(r => r.status === 'completed').length,
                failedRequests: data.filter(r => r.status === 'error').length,
                averageResponseTime: data.reduce((acc, curr) => {
                    if (curr.completion_time) {
                        const duration = new Date(curr.completion_time) - new Date(curr.created_at);
                        return acc + duration;
                    }
                    return acc;
                }, 0) / data.length
            };
        } catch (error) {
            console.error('Error getting system stats:', error);
            throw error;
        }
    }
};
