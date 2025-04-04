import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CheckCircle2 } from 'lucide-react';

const UpdateModal = ({ isAuthenticated = false }) => {
  const [isOpen, setIsOpen] = React.useState(true);
  const [error, setError] = React.useState(null);
  
  // Check if update was previously deferred
  const [updateDeferred] = React.useState(() => {
    return localStorage.getItem('updateDeferred') === 'true';
  });

  // Determine if the dialog should be closeable
  // Can only close if authenticated AND update hasn't been deferred before
  const canClose = isAuthenticated && !updateDeferred;

  const handleInstall = async () => {
    try {
      setError(null);
      console.log('Attempting to install update...');
      await window.electronAPI.installUpdate();
    } catch (error) {
      console.error('Failed to install update:', error);
      setError('Failed to install update. Please try again.');
    }
  };

  const handleClose = async () => {
    try {
      setError(null);
      
      // Mark that the update was deferred
      localStorage.setItem('updateDeferred', 'true');
      
      // Close the dialog
      setIsOpen(false);
      
    } catch (error) {
      console.error('Failed to close dialog:', error);
      setError('Failed to close dialog. Please try again.');
    }
  };

  const handleForceClose = async () => {
    try {
      setError(null);
      console.log('Attempting to close app...');
      await window.electronAPI.closeApp();
    } catch (error) {
      console.error('Failed to close app:', error);
      setError('Failed to close application. Please try again.');
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent className="max-w-md bg-gray-900 border border-gray-800 text-white shadow-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-center text-white">
            Application Update
          </DialogTitle>
        </DialogHeader>
        <div className="p-6">
          <div className="space-y-8">
            <div className="flex items-center justify-center">
              <CheckCircle2 className="h-16 w-16 text-green-500" />
            </div>
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-center text-white">
                Update Ready to Install
              </h3>
              <p className="text-sm text-gray-400 text-center">
                A new version of the application is ready to install. 
                The application will restart automatically to complete the installation.
                {!canClose && (
                  <span className="block mt-2 text-yellow-400">
                    This update must be installed to continue using the application.
                  </span>
                )}
              </p>
              <div className="flex justify-center gap-4 pt-2">
                <Button
                  onClick={handleInstall}
                  className="bg-green-600 hover:bg-green-700 transition-colors text-white"
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Install Now
                </Button>
                {canClose ? (
                  <Button
                    onClick={handleClose}
                    variant="outline"
                    className="border-gray-700 text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
                  >
                    Later
                  </Button>
                ) : (
                  <Button
                    onClick={handleForceClose}
                    variant="outline"
                    className="border-gray-700 text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
                  >
                    Close App
                  </Button>
                )}
              </div>
            </div>
          </div>
          {error && (
            <div className="mt-4 p-3 bg-red-900/50 border border-red-700 rounded-lg">
              <p className="text-sm text-red-400 text-center">{error}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default UpdateModal;
